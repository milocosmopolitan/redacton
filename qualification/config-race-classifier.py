"""Select the requested turn from the latest user content, not its ordinal."""
FIRST_PROMPT = 'Run the supplied local synthetic tool once.'
SECOND_PROMPT = 'Run the second supplied local synthetic tool once.'
import re

HELPER_OUTCOMES = ('DECLARED_OK', 'DECLARED_TIMEOUT', 'DECLARED_ENGINE_UNAVAILABLE', 'DECLARED_BLOCKED', 'DECLARED_FAILED', 'PROCESS_REJECTED', 'PROCESS_DENIED', 'PROCESS_EXIT_NONZERO', 'PROCESS_SHAPE_INVALID', 'STDOUT_TRUNCATED', 'STDERR_TRUNCATED', 'STDERR_PRESENT', 'INVALID_JSON', 'IDENTITY_MISMATCH', 'STATUS_UNKNOWN')


def helper_diagnostics(history):
    values = {}
    pattern = r'CONFIG_HELPER_([12])_(' + '|'.join(HELPER_OUTCOMES) + r')_(N|-?[0-9]{1,10})_([0-4])_([01])_([01])_([01])_([01])(?![0-9])'
    for match in re.finditer(pattern, history):
        index, outcome, exit_code, bucket, stdout, stderr, present, identity = match.groups()
        exit_code = None if exit_code == 'N' else int(exit_code)
        if exit_code is not None and not -2147483648 <= exit_code <= 2147483647:
            continue
        values[int(index)] = {'ordinal': int(index), 'outcome': outcome, 'exitCode': exit_code, 'elapsedBucket': int(bucket), 'stdoutTruncated': stdout == '1', 'stderrTruncated': stderr == '1', 'stderrPresent': present == '1', 'identityMatched': identity == '1'}
    return values


def second_tool_code(block):
    if not isinstance(block, dict):
        return 'UNKNOWN'
    if block.get('is_error') is not True:
        return 'SUCCESS'
    text = block.get('content', '')
    if not isinstance(text, str):
        text = '\n'.join(item.get('text', '') for item in text if isinstance(item, dict) and isinstance(item.get('text'), str)) if isinstance(text, list) else ''
    for code in ('REDACTON_WITHHELD', 'REDACTON_UNSUPPORTED_SHAPE', 'REDACTON_TOOL_DENIED'):
        if re.search(r'(?<![A-Z0-9_])' + code + r'(?![A-Z0-9_])', text):
            return code
    return 'UNKNOWN'


def request_stage(content):
    if not isinstance(content, list):
        content = [{'type': 'text', 'text': content}] if isinstance(content, str) else []
    ids = [block.get('tool_use_id') for block in content if isinstance(block, dict) and block.get('type') == 'tool_result']
    texts = [block.get('text', '') for block in content if isinstance(block, dict) and block.get('type') == 'text' and isinstance(block.get('text'), str)]
    if 'config_tool_1' in ids:
        return 3
    if any(SECOND_PROMPT in text for text in texts):
        return 2
    if 'config_tool_0' in ids:
        return 1
    if any(FIRST_PROMPT in text for text in texts):
        return 0
    return -1
