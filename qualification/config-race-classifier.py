"""Select the requested turn from the latest user content, not its ordinal."""
FIRST_PROMPT = 'Run the supplied local synthetic tool once.'
SECOND_PROMPT = 'Run the second supplied local synthetic tool once.'


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
