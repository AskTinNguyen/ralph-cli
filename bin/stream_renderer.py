#!/usr/bin/env python3
"""
Stream renderer for Claude CLI output.
Parses stream-json format and displays formatted output with tool calls.
"""

import sys
import json

# ANSI color codes
RESET = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
GREEN = "\033[92m"
MAGENTA = "\033[95m"
BLUE = "\033[94m"

# Track state for deduplication
last_text = ""
shown_tools = set()


def render_event(data):
    """Process a single stream-json event and print formatted output."""
    global last_text, shown_tools

    try:
        event_type = data.get("type")

        # Assistant message - contains text and tool_use
        if event_type == "assistant":
            message = data.get("message", {})
            content = message.get("content", [])

            for block in content:
                block_type = block.get("type")

                if block_type == "text":
                    text = block.get("text", "")
                    # Only print new text (avoid duplicates from streaming)
                    if text and text != last_text:
                        # Print only the new part if it's an extension
                        if text.startswith(last_text):
                            new_part = text[len(last_text):]
                            print(new_part, end="", flush=True)
                        else:
                            print(text, end="", flush=True)
                        last_text = text

                elif block_type == "tool_use":
                    tool_id = block.get("id", "")
                    tool_name = block.get("name", "unknown")
                    tool_input = block.get("input", {})

                    # Only show each tool use once
                    if tool_id and tool_id not in shown_tools:
                        shown_tools.add(tool_id)

                        # Format tool display
                        if tool_name == "Read":
                            file_path = tool_input.get("file_path", "")
                            print(f"\n{YELLOW}[Read]{RESET} {file_path}", flush=True)
                        elif tool_name == "Write":
                            file_path = tool_input.get("file_path", "")
                            print(f"\n{GREEN}[Write]{RESET} {file_path}", flush=True)
                        elif tool_name == "Edit":
                            file_path = tool_input.get("file_path", "")
                            print(f"\n{CYAN}[Edit]{RESET} {file_path}", flush=True)
                        elif tool_name == "Bash":
                            cmd = tool_input.get("command", "")
                            desc = tool_input.get("description", "")
                            if desc:
                                print(f"\n{MAGENTA}[Bash]{RESET} {desc}", flush=True)
                            else:
                                # Truncate long commands
                                cmd_display = cmd[:60] + "..." if len(cmd) > 60 else cmd
                                print(f"\n{MAGENTA}[Bash]{RESET} {cmd_display}", flush=True)
                        elif tool_name in ("Glob", "Grep"):
                            pattern = tool_input.get("pattern", "")
                            print(f"\n{BLUE}[{tool_name}]{RESET} {pattern}", flush=True)
                        else:
                            print(f"\n{YELLOW}[{tool_name}]{RESET}", flush=True)

        # User message - contains tool results
        elif event_type == "user":
            message = data.get("message", {})
            content = message.get("content", [])

            for block in content:
                if block.get("type") == "tool_result":
                    # Could show tool results here if needed
                    pass

        # Result - final summary
        elif event_type == "result":
            result_text = data.get("result", "")
            if result_text and result_text != last_text:
                print(f"\n{result_text}", flush=True)
                last_text = result_text

        # System init - show session start
        elif event_type == "system" and data.get("subtype") == "init":
            model = data.get("model", "unknown")
            print(f"{DIM}[Session: {model}]{RESET}\n", flush=True)

    except Exception:
        # Silently ignore parsing errors
        pass


def main():
    """Read stream-json from stdin and render formatted output."""
    # Ensure stdout is unbuffered for real-time display
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(line_buffering=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        # Skip non-JSON lines
        if not line.startswith("{"):
            continue

        try:
            data = json.loads(line)
            render_event(data)
        except json.JSONDecodeError:
            pass


if __name__ == "__main__":
    main()
