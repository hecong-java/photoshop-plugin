# SSH MCP 服务器使用说明

## 项目信息

- **GitHub 地址**: https://github.com/mixelpixx/SSH-MCP
- **安装方式**: 通过 npx 直接运行，无需克隆仓库
- **功能**: 提供 SSH 连接、命令执行、文件传输等能力

## 配置文件

### 1. MCP 配置文件 (mcp.json)

```json
{
  "mcpServers": {
    "ssh-server": {
      "command": "npx",
      "args": [
        "-y",
        "@mixelpixx/ssh-mcp@latest"
      ],
      "env": {},
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 2. 服务器配置 (ssh-config.json)

```json
{
  "servers": [
    {
      "name": "MyServer",
      "host": "123.207.74.28",
      "port": 22,
      "username": "ubuntu",
      "auth": {
        "type": "password",
        "password": "Long112200!!"
      }
    }
  ]
}
```

## 使用方法

### 方式一：在 Claude Desktop 中使用

1. 打开 Claude Desktop
2. 进入 Settings > Developer > Edit Config
3. 将 `mcp.json` 内容添加到配置中
4. 重启 Claude Desktop
5. 现在可以在对话中使用 SSH 相关工具

### 方式二：在 VS Code 中使用

1. 安装 MCP 扩展
2. 创建 `.vscode/mcp.json` 文件
3. 添加相同的配置内容
4. 重启 VS Code

### 方式三：命令行直接使用

```bash
# 使用 npx 直接运行
npx -y @mixelpixx/ssh-mcp@latest
```

## 可用工具

连接成功后，可以使用以下工具：

### 连接管理
- `ssh_connect` - 建立 SSH 连接
- `ssh_disconnect` - 断开 SSH 连接

### 命令执行
- `ssh_exec` - 在远程服务器上执行命令

### 文件操作
- `ssh_upload_file` - 上传文件到远程服务器
- `ssh_download_file` - 从远程服务器下载文件
- `ssh_list_files` - 列出远程目录中的文件

### 网络设备管理
- `switch_discover_device` - 发现网络交换机设备
- `switch_show_interfaces` - 显示交换机接口状态
- `switch_backup_config` - 备份交换机配置

### USB-to-Serial 控制台
- `serial_list_ports` - 列出可用的串口
- `serial_connect` - 通过串口连接到设备
- `serial_send_command` - 发送命令到串口设备

## 使用示例

### 连接到服务器
```
请连接到我的服务器 123.207.74.28，用户名是 ubuntu，密码是 Long112200!!
```

### 执行命令
```
在远程服务器上运行 "ls -la" 命令
```

### 上传文件
```
将本地的 index.html 文件上传到服务器的 /var/www/html/ 目录
```

### 下载文件
```
从服务器下载 /var/log/nginx/access.log 文件到本地
```

## 安全提示

1. **密码安全**: 生产环境中建议使用 SSH 密钥认证而非密码
2. **访问控制**: 限制可访问的 IP 地址范围
3. **日志审计**: 定期检查 SSH 访问日志
4. **密钥管理**: 妥善保管 SSH 私钥，不要提交到版本控制

## 故障排除

### 连接失败
- 检查服务器 IP 和端口是否正确
- 确认用户名和密码是否正确
- 检查服务器的 SSH 服务是否运行
- 检查防火墙设置

### 命令执行失败
- 确认用户有执行该命令的权限
- 检查命令路径是否正确
- 查看错误输出获取详细信息

### 文件传输失败
- 确认本地和远程路径是否正确
- 检查用户是否有读写目标目录的权限
- 确认磁盘空间是否充足

## 相关资源

- **GitHub 仓库**: https://github.com/mixelpixx/SSH-MCP
- **MCP 文档**: https://modelcontextprotocol.io
- **Claude Desktop**: https://claude.ai/download
- **VS Code MCP 扩展**: 在 VS Code 扩展市场搜索 MCP

## 更新日志

### 2025-03-10
- 初始配置完成
- 添加服务器配置 (123.207.74.28)
- 创建使用说明文档
