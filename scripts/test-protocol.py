"""Read-only stdio discovery. Never issues a browser operation."""
import json
from pathlib import Path
import shutil
import subprocess

root=Path(__file__).resolve().parents[1]
requests=[
 {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'release-check','version':'1'}}},
 {'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}},
]
result=subprocess.run([shutil.which('node'),str(root/'server/mcp.js')],input=''.join(json.dumps(r)+'\n' for r in requests),capture_output=True,text=True,timeout=15,check=True)
responses={r['id']:r for r in map(json.loads,result.stdout.splitlines())}
assert responses[1]['result']['serverInfo']['name']=='codex-chrome'
tools=responses[2]['result']['tools']
assert {tool['name'] for tool in tools}=={'tabs','go','snap','do','read','shot','js','log'}
assert all(tool['inputSchema']['type']=='object' and tool['description'] for tool in tools)
assert 'saved scope' in responses[1]['result']['instructions']
print('PROTOCOL VERIFIED')
