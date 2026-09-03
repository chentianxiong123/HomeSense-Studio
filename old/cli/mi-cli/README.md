# mi-cli

小米智能家居设备控制 CLI，专为 AI Agent 设计。

## 安装

```bash
pip install mi_cli-*-py3-none-any.whl
```

## 核心能力

- **扫码登录**米家账号
- **AI 友好的设备发现**，一句话获取设备列表和能力
- **用自然语言 capability 名称控制设备**（不需要懂 MIoT 协议）
- **小爱音箱语音控制**
- **红外设备控制**

## 快速开始

```bash
mi-cli run '{"action":"login_qr"}'
mi-cli run '{"action":"discover","summary_only":true}'
mi-cli run '{"action":"device_action","did":"设备ID","capability":"turn_on"}'
mi-cli run '{"action":"speaker_execute","text":"播放音乐","did":"音箱ID"}'
```

## 设计目标

- 输出结构化，AI 可直接解析
- capability 抽象层：AI 说"开灯"，CLI 自动解析为 siid/aiid
- 错误码语义明确，AI 可据此决策下一步

## License

MIT