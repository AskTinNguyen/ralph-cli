#!/usr/bin/env python3
"""
PRD Parser Library for Ralph CLI.

This module provides PRD (Product Requirements Document) parsing utilities
including prompt rendering, story selection, and activity log management.

Usage from bash:
    python3 "$SCRIPT_DIR/lib/prd-parser.py" <command> [args...]

Commands:
    render_prompt <src> <dst> <json_vars_file> [story_meta] [story_block]
    render_retry_prompt <src> <dst> <json_vars_file> [story_meta] [story_block] [failure_context_file] [retry_attempt] [retry_max]
    select_story <prd_path> <meta_out> <block_out>
    remaining_stories <meta_file>
    story_field <meta_file> <field>
    append_run_summary <activity_log_path> <line>
"""

import json
import re
import sys
from pathlib import Path


def render_prompt(src_path: str, dst_path: str, vars_file: str,
                  story_meta_path: str = "", story_block_path: str = "") -> None:
    """
    Render a prompt template by substituting {{VAR}} placeholders.

    Args:
        src_path: Path to source template file
        dst_path: Path to write rendered prompt
        vars_file: Path to JSON file containing template variables
        story_meta_path: Optional path to story metadata JSON file
        story_block_path: Optional path to story content block file
    """
    src = Path(src_path).read_text()

    # Load template variables from JSON file
    repl = json.loads(Path(vars_file).read_text())

    # Load story metadata if provided
    story = {"id": "", "title": "", "block": ""}
    if story_meta_path and Path(story_meta_path).exists():
        try:
            meta = json.loads(Path(story_meta_path).read_text())
            story["id"] = meta.get("id", "") or ""
            story["title"] = meta.get("title", "") or ""
        except Exception:
            pass

    # Load story block content if provided
    if story_block_path and Path(story_block_path).exists():
        story["block"] = Path(story_block_path).read_text()

    # Add story fields to replacements
    repl["STORY_ID"] = story["id"]
    repl["STORY_TITLE"] = story["title"]
    repl["STORY_BLOCK"] = story["block"]

    # Perform template substitution
    for k, v in repl.items():
        src = src.replace("{{" + k + "}}", str(v))

    Path(dst_path).write_text(src)


def analyze_previous_approach(context: str) -> str:
    """
    Analyze what the previous approach tried based on failure context.

    Args:
        context: The failure context from previous run

    Returns:
        Analysis string with bullet points
    """
    if not context:
        return "No previous failure context available."

    lines = context.split('\n')
    analysis = []

    # Look for common patterns
    for line in lines:
        line_lower = line.lower()
        if 'import' in line_lower and ('error' in line_lower or 'fail' in line_lower):
            analysis.append("- Import statements may have issues")
        if 'route' in line_lower and ('not found' in line_lower or '404' in line_lower):
            analysis.append("- Route registration may be missing")
        if 'expect' in line_lower and 'received' in line_lower:
            analysis.append("- Test assertions did not match expected values")
        if 'undefined' in line_lower or 'null' in line_lower:
            analysis.append("- Some variables or properties were undefined/null")
        if 'type' in line_lower and 'error' in line_lower:
            analysis.append("- Type mismatches were detected")

    if not analysis:
        analysis.append("- Review the full log for specific failure details")

    return '\n'.join(list(set(analysis))[:5])  # Dedupe and limit to 5


def suggest_alternatives(context: str) -> str:
    """
    Suggest alternative approaches based on failure patterns.

    Args:
        context: The failure context from previous run

    Returns:
        Suggestions string with bullet points
    """
    if not context:
        return "- Try a simpler approach first\n- Double-check the requirements"

    context_lower = context.lower()
    suggestions = []

    # Pattern-based suggestions
    if 'import' in context_lower and ('error' in context_lower or 'module' in context_lower):
        suggestions.append("- Verify all import paths are correct and modules exist")
        suggestions.append("- Check for circular dependencies")

    if 'route' in context_lower or '404' in context_lower:
        suggestions.append("- Ensure the route is registered in the router/app")
        suggestions.append("- Check route path spelling and parameters")

    if 'expect' in context_lower or 'assert' in context_lower:
        suggestions.append("- Match the expected output format exactly")
        suggestions.append("- Check data types (string vs number, etc.)")

    if 'undefined' in context_lower or 'null' in context_lower:
        suggestions.append("- Add null checks and default values")
        suggestions.append("- Verify object properties exist before accessing")

    if 'timeout' in context_lower:
        suggestions.append("- Reduce operation complexity or add pagination")
        suggestions.append("- Check for infinite loops or blocking operations")

    if 'permission' in context_lower or 'access' in context_lower:
        suggestions.append("- Check file/directory permissions")
        suggestions.append("- Verify authentication/authorization is set up")

    if 'syntax' in context_lower:
        suggestions.append("- Check for missing brackets, semicolons, or quotes")
        suggestions.append("- Validate JSON/YAML/config file formats")

    if not suggestions:
        suggestions.append("- Read the failing test/verification command carefully")
        suggestions.append("- Check if dependencies are installed")
        suggestions.append("- Try a more incremental approach")

    return '\n'.join(suggestions[:4])  # Limit to 4 suggestions


def render_retry_prompt(src_path: str, dst_path: str, vars_file: str,
                        story_meta_path: str = "", story_block_path: str = "",
                        failure_context_file: str = "", retry_attempt: str = "1",
                        retry_max: str = "3") -> None:
    """
    Render a retry prompt template with failure context variables.

    Args:
        src_path: Path to source template file
        dst_path: Path to write rendered prompt
        vars_file: Path to JSON file containing template variables
        story_meta_path: Optional path to story metadata JSON file
        story_block_path: Optional path to story content block file
        failure_context_file: Optional path to failure context file
        retry_attempt: Current retry attempt number
        retry_max: Maximum retry attempts
    """
    src = Path(src_path).read_text()

    # Load template variables from JSON file
    repl = json.loads(Path(vars_file).read_text())

    # Read failure context from file
    failure_context = ""
    if failure_context_file and Path(failure_context_file).exists():
        failure_context = Path(failure_context_file).read_text()

    # Analyze previous approach from failure context
    previous_approach = analyze_previous_approach(failure_context)

    # Generate suggestions based on failure patterns
    suggestions = suggest_alternatives(failure_context)

    # Add retry-specific variables
    repl["FAILURE_CONTEXT"] = failure_context
    repl["PREVIOUS_APPROACH"] = previous_approach
    repl["SUGGESTIONS"] = suggestions
    repl["RETRY_ATTEMPT"] = retry_attempt
    repl["RETRY_MAX"] = retry_max

    # Load story metadata if provided
    story = {"id": "", "title": "", "block": ""}
    if story_meta_path and Path(story_meta_path).exists():
        try:
            meta = json.loads(Path(story_meta_path).read_text())
            story["id"] = meta.get("id", "") or ""
            story["title"] = meta.get("title", "") or ""
        except Exception:
            pass

    # Load story block content if provided
    if story_block_path and Path(story_block_path).exists():
        story["block"] = Path(story_block_path).read_text()

    # Add story fields to replacements
    repl["STORY_ID"] = story["id"]
    repl["STORY_TITLE"] = story["title"]
    repl["STORY_BLOCK"] = story["block"]

    # Perform template substitution
    for k, v in repl.items():
        src = src.replace("{{" + k + "}}", str(v))

    Path(dst_path).write_text(src)


def select_story(prd_path: str, meta_out: str, block_out: str) -> None:
    """
    Select the next uncompleted story from a PRD file.

    Args:
        prd_path: Path to PRD file
        meta_out: Path to write story metadata JSON
        block_out: Path to write story content block
    """
    prd_path = Path(prd_path)
    meta_out = Path(meta_out)
    block_out = Path(block_out)

    text = prd_path.read_text().splitlines()
    pattern = re.compile(r'^###\s+(\[(?P<status>[ xX])\]\s+)?(?P<id>US-\d+):\s*(?P<title>.+)$')

    stories = []
    current = None
    for line in text:
        m = pattern.match(line)
        if m:
            if current:
                stories.append(current)
            current = {
                "id": m.group("id"),
                "title": m.group("title").strip(),
                "status": (m.group("status") or " "),
                "lines": [line],
            }
        elif current is not None:
            current["lines"].append(line)
    if current:
        stories.append(current)

    if not stories:
        meta_out.write_text(json.dumps({"ok": False, "error": "No stories found in PRD"}, indent=2) + "\n")
        block_out.write_text("")
        return

    def is_done(story):
        return str(story.get("status", "")).strip().lower() == "x"

    remaining = [s for s in stories if not is_done(s)]
    meta = {"ok": True, "total": len(stories), "remaining": len(remaining)}

    if remaining:
        target = remaining[0]
        meta.update({
            "id": target["id"],
            "title": target["title"],
        })
        block_out.write_text("\n".join(target["lines"]))
    else:
        block_out.write_text("")

    meta_out.write_text(json.dumps(meta, indent=2) + "\n")


def remaining_stories(meta_file: str) -> None:
    """
    Get the count of remaining stories from a metadata file.

    Args:
        meta_file: Path to story metadata JSON file

    Prints:
        The remaining story count
    """
    data = json.loads(Path(meta_file).read_text())
    print(data.get("remaining", "unknown"))


def story_field(meta_file: str, field: str) -> None:
    """
    Get a specific field from a story metadata file.

    Args:
        meta_file: Path to story metadata JSON file
        field: Name of the field to extract

    Prints:
        The field value or empty string if not found
    """
    data = json.loads(Path(meta_file).read_text())
    print(data.get(field, ""))


def append_run_summary(activity_log_path: str, line: str) -> None:
    """
    Append a run summary line to the activity log.

    Inserts the line after "## Run Summary" header, or creates the
    header structure if it doesn't exist.

    Args:
        activity_log_path: Path to activity log file
        line: The summary line to append
    """
    path = Path(activity_log_path)
    text = path.read_text().splitlines()
    out = []
    inserted = False

    for l in text:
        out.append(l)
        if not inserted and l.strip() == "## Run Summary":
            out.append(f"- {line}")
            inserted = True

    if not inserted:
        out = [
            "# Activity Log",
            "",
            "## Run Summary",
            f"- {line}",
            "",
            "## Events",
            "",
        ] + text

    path.write_text("\n".join(out).rstrip() + "\n")


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == "render_prompt":
        # render_prompt <src> <dst> <vars_file> [story_meta] [story_block]
        if len(sys.argv) < 5:
            print("Usage: render_prompt <src> <dst> <vars_file> [story_meta] [story_block]", file=sys.stderr)
            sys.exit(1)
        render_prompt(
            sys.argv[2], sys.argv[3], sys.argv[4],
            sys.argv[5] if len(sys.argv) > 5 else "",
            sys.argv[6] if len(sys.argv) > 6 else ""
        )

    elif command == "render_retry_prompt":
        # render_retry_prompt <src> <dst> <vars_file> [story_meta] [story_block] [failure_context] [retry_attempt] [retry_max]
        if len(sys.argv) < 5:
            print("Usage: render_retry_prompt <src> <dst> <vars_file> [story_meta] [story_block] [failure_context] [retry_attempt] [retry_max]", file=sys.stderr)
            sys.exit(1)
        render_retry_prompt(
            sys.argv[2], sys.argv[3], sys.argv[4],
            sys.argv[5] if len(sys.argv) > 5 else "",
            sys.argv[6] if len(sys.argv) > 6 else "",
            sys.argv[7] if len(sys.argv) > 7 else "",
            sys.argv[8] if len(sys.argv) > 8 else "1",
            sys.argv[9] if len(sys.argv) > 9 else "3"
        )

    elif command == "select_story":
        # select_story <prd_path> <meta_out> <block_out>
        if len(sys.argv) < 5:
            print("Usage: select_story <prd_path> <meta_out> <block_out>", file=sys.stderr)
            sys.exit(1)
        select_story(sys.argv[2], sys.argv[3], sys.argv[4])

    elif command == "remaining_stories":
        # remaining_stories <meta_file>
        if len(sys.argv) < 3:
            print("Usage: remaining_stories <meta_file>", file=sys.stderr)
            sys.exit(1)
        remaining_stories(sys.argv[2])

    elif command == "story_field":
        # story_field <meta_file> <field>
        if len(sys.argv) < 4:
            print("Usage: story_field <meta_file> <field>", file=sys.stderr)
            sys.exit(1)
        story_field(sys.argv[2], sys.argv[3])

    elif command == "append_run_summary":
        # append_run_summary <activity_log_path> <line>
        if len(sys.argv) < 4:
            print("Usage: append_run_summary <activity_log_path> <line>", file=sys.stderr)
            sys.exit(1)
        append_run_summary(sys.argv[2], sys.argv[3])

    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
