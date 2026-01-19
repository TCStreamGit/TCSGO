import re

# Read the file
path = r'A:\Development Environment\Source Control\GitHub\TCSGO\tools\rename_assets.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add & handling to normalize_text
old_code = '''    result = text.lower()
    result = result.replace("\xe2\x98\x85", "").replace("|", " ")'''

new_code = '''    result = text.lower()
    result = result.replace("&", " and ")  # Dreams & Nightmares -> Dreams and Nightmares
    result = result.replace("\xe2\x98\x85", "").replace("|", " ")'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed ampersand handling')
else:
    print('Pattern not found, checking alternative...')
    # Check what the actual code looks like
    import re
    match = re.search(r'result = text\.lower\(\).*?result = result\.replace', content, re.DOTALL)
    if match:
        print(f'Found: {repr(match.group(0)[:100])}')
