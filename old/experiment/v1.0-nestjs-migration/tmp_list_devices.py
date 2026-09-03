"""List devices nicely"""
import json, urllib.request

resp = urllib.request.urlopen(
    urllib.request.Request(
        "http://127.0.0.1:3000/api/devices/discover",
        data=b'{}',
        headers={"Content-Type": "application/json"},
    ),
    timeout=60,
)
d = json.loads(resp.read())
print(f"设备数: {len(d.get('devices',[]))}  家庭数: {len(d.get('homes',[]))}")
print()
for dev in d.get('devices', []):
    name = dev.get('name', '?')
    did = dev.get('did', '?')
    model = dev.get('model', '?')
    conn = dev.get('connection_type', '?')
    room = dev.get('room_name', '') or '(无房间)'
    parent = dev.get('parent_id', '')
    feat = len(dev.get('features', []))
    ent = len(dev.get('entities', []))
    cap = list(dev.get('capability_profile', {}).get('controls', {}).keys())
    spec = dev.get('device_type', '') or '无'
    ps = f' 父设备:{parent}' if parent else ''
    print(f"{name}")
    print(f"  DID={did}  连接={conn}  房间={room}")
    print(f"  model={model}")
    print(f"  特征数={feat}  实体数={ent}  能力={cap}{ps}")
    print(f"  设备类型={spec}")
    print()