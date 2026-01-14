#!/usr/bin/env python3
"""
Run metadata writer - generates markdown summaries for Ralph build runs.

Usage:
    python3 run-meta-writer.py <json_file> <output_file>

Where json_file contains all the run metadata as a JSON object.
"""

import json
import sys
from typing import Optional, Dict, Any


def format_commits(commit_list: str) -> str:
    """Format commit list for markdown."""
    if not commit_list or commit_list.strip() == "":
        return "- (none)"
    return commit_list


def format_files(files: str) -> str:
    """Format file list for markdown."""
    if not files or files.strip() == "":
        return "- (none)"
    return files


def format_dirty_files(files: str) -> str:
    """Format uncommitted changes for markdown."""
    if not files or files.strip() == "":
        return "- (clean)"
    return files


def is_valid_value(value: Any) -> bool:
    """Check if a value is valid (not None, not "null", not empty)."""
    return value is not None and value != "null" and value != ""


def write_run_metadata(data: Dict[str, Any], output_path: str) -> None:
    """
    Write run metadata to markdown file.

    Args:
        data: Dictionary containing all run metadata
        output_path: Path to write the markdown file
    """
    with open(output_path, 'w') as f:
        # Header
        f.write("# Ralph Run Summary\n\n")

        # Basic info
        f.write(f"- Run ID: {data.get('run_id', '')}\n")
        f.write(f"- Iteration: {data.get('iteration', '')}\n")
        f.write(f"- Mode: {data.get('mode', '')}\n")

        story_id = data.get('story_id', '')
        if story_id:
            story_title = data.get('story_title', '')
            f.write(f"- Story: {story_id}: {story_title}\n")

        f.write(f"- Started: {data.get('started', '')}\n")
        f.write(f"- Ended: {data.get('ended', '')}\n")
        f.write(f"- Duration: {data.get('duration', '')}s\n")
        f.write(f"- Status: {data.get('status', '')}\n")
        f.write(f"- Log: {data.get('log_file', '')}\n\n")

        # Git section
        f.write("## Git\n")
        head_before = data.get('head_before', 'unknown')
        head_after = data.get('head_after', 'unknown')
        f.write(f"- Head (before): {head_before}\n")
        f.write(f"- Head (after): {head_after}\n\n")

        f.write("### Commits\n")
        f.write(format_commits(data.get('commit_list', '')) + "\n\n")

        f.write("### Changed Files (commits)\n")
        f.write(format_files(data.get('changed_files', '')) + "\n\n")

        f.write("### Uncommitted Changes\n")
        f.write(format_dirty_files(data.get('dirty_files', '')) + "\n\n")

        # Token usage
        f.write("## Token Usage\n")
        input_tokens = data.get('input_tokens')
        output_tokens = data.get('output_tokens')

        if is_valid_value(input_tokens):
            f.write(f"- Input tokens: {input_tokens}\n")
        else:
            f.write("- Input tokens: (unavailable)\n")

        if is_valid_value(output_tokens):
            f.write(f"- Output tokens: {output_tokens}\n")
        else:
            f.write("- Output tokens: (unavailable)\n")

        # Prefer routed_model over token_model
        routed_model = data.get('routed_model')
        token_model = data.get('token_model')
        display_model = routed_model if is_valid_value(routed_model) else token_model

        if is_valid_value(display_model):
            f.write(f"- Model: {display_model}\n")

        token_estimated = data.get('token_estimated', 'false')
        f.write(f"- Estimated: {token_estimated}\n")

        if is_valid_value(input_tokens) and is_valid_value(output_tokens):
            try:
                total = int(input_tokens) + int(output_tokens)
                f.write(f"- Total tokens: {total}\n")
            except (ValueError, TypeError):
                pass

        f.write("\n")

        # Retry statistics
        f.write("## Retry Statistics\n")
        retry_count = int(data.get('retry_count', 0))
        if retry_count > 0:
            retry_time = data.get('retry_time', 0)
            f.write(f"- Retry count: {retry_count}\n")
            f.write(f"- Total retry wait time: {retry_time}s\n")
        else:
            f.write("- Retry count: 0 (succeeded on first attempt)\n")
        f.write("\n")

        # Agent switches
        f.write("## Agent Switches\n")
        switch_count = int(data.get('switch_count', 0))
        if switch_count > 0:
            f.write(f"- Switch count: {switch_count}\n")
            f.write(f"- From: {data.get('switch_from', '')}\n")
            f.write(f"- To: {data.get('switch_to', '')}\n")
            f.write(f"- Reason: {data.get('switch_reason', '')}\n")
        else:
            f.write("- Switch count: 0 (no agent switches)\n")
        f.write("\n")

        # Routing decision
        f.write("## Routing Decision\n")
        if is_valid_value(routed_model):
            f.write(f"- Model: {routed_model}\n")
            complexity_score = data.get('complexity_score')
            if is_valid_value(complexity_score) and complexity_score != 'n/a':
                f.write(f"- Complexity score: {complexity_score}/10\n")
            routing_reason = data.get('routing_reason')
            if is_valid_value(routing_reason) and routing_reason != 'n/a':
                f.write(f"- Reason: {routing_reason}\n")
        else:
            f.write("- Model: (not routed)\n")
        f.write("\n")

        # Cost estimate vs actual
        f.write("## Cost Estimate vs Actual\n")
        est_cost = data.get('est_cost')
        est_tokens = data.get('est_tokens')

        if is_valid_value(est_cost) and est_cost not in ('n/a', 'null'):
            f.write("### Pre-execution Estimate\n")
            f.write(f"- Estimated cost: ${est_cost}\n")
            if is_valid_value(est_tokens):
                f.write(f"- Estimated tokens: {est_tokens}\n")
        else:
            f.write("### Pre-execution Estimate\n")
            f.write("- (estimate unavailable)\n")
        f.write("\n")

        # Actual usage
        f.write("### Actual Usage\n")
        if is_valid_value(input_tokens) and is_valid_value(output_tokens):
            try:
                actual_total = int(input_tokens) + int(output_tokens)
                f.write(f"- Actual tokens: {actual_total} (input: {input_tokens}, output: {output_tokens})\n")

                # Calculate actual cost if model available
                cost_model = routed_model if is_valid_value(routed_model) else token_model
                if is_valid_value(cost_model):
                    # Note: Actual cost calculation is done in bash since it requires the routing lib
                    # This placeholder allows bash to optionally append the cost
                    actual_cost = data.get('actual_cost')
                    if is_valid_value(actual_cost):
                        f.write(f"- Actual cost: ${actual_cost}\n")
            except (ValueError, TypeError):
                f.write("- (actual usage unavailable)\n")
        else:
            f.write("- (actual usage unavailable)\n")
        f.write("\n")

        # Estimate accuracy
        f.write("### Estimate Accuracy\n")
        if is_valid_value(est_tokens) and is_valid_value(input_tokens) and is_valid_value(output_tokens):
            try:
                est_tok = int(est_tokens)
                actual_total = int(input_tokens) + int(output_tokens)
                if est_tok > 0:
                    variance_pct = round(((actual_total - est_tok) / est_tok) * 100, 1)
                    f.write(f"- Token variance: {variance_pct}% (estimated: {est_tok}, actual: {actual_total})\n")
                else:
                    f.write("- (variance not available)\n")
            except (ValueError, TypeError, ZeroDivisionError):
                f.write("- (variance not available)\n")
        else:
            f.write("- (variance not available)\n")
        f.write("\n")


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <json_file> <output_file>", file=sys.stderr)
        sys.exit(1)

    json_file = sys.argv[1]
    output_file = sys.argv[2]

    try:
        with open(json_file, 'r') as f:
            data = json.load(f)

        write_run_metadata(data, output_file)

    except FileNotFoundError:
        print(f"Error: JSON file not found: {json_file}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in {json_file}: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error writing metadata: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
