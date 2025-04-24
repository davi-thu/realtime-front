import express from 'express';
import multer from 'multer';
import { WebSocket } from 'ws';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 先测试导入
try {
    console.log('正在导入视频处理模块...');
    const { processVideoFrames, readFileAsBase64 } = await import('../views/FileUpload/videoProcessor.js');
    console.log('视频处理模块导入成功:', {
        processVideoFrames: typeof processVideoFrames,
        readFileAsBase64: typeof readFileAsBase64
    });
} catch (error) {
    console.error('导入视频处理模块失败:', error);
}

// 导入视频处理相关函数
import { processVideoFrames, readFileAsBase64 } from '../views/FileUpload/videoProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const router = express.Router();

// 确保上传目录存在
const uploadDir = join(__dirname, '../../uploads');
await fs.mkdir(uploadDir, { recursive: true });



// 配置 multer
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        try {
            await fs.access(uploadDir);
            cb(null, uploadDir);
        } catch (error) {
            console.error('上传目录不存在或无访问权限:', error);
            cb(new Error('上传目录配置错误'));
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.originalname.split('.').pop();
        cb(null, `${file.fieldname}-${uniqueSuffix}.${ext}`);
    }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
    console.log('正在处理文件:', file.originalname);
    console.log('文件类型:', file.mimetype);

    if (file.fieldname === 'video') {
        if (!file.mimetype.startsWith('video/')) {
            return cb(new Error('只接受视频文件'));
        }
    } else if (file.fieldname === 'audio') {
        if (!file.mimetype.startsWith('audio/')) {
            return cb(new Error('只接受音频文件'));
        }
    }
    cb(null, true);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 限制文件大小为 50MB
    }
}).fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]);

// 处理文件上传的路由
// 在处理上传请求的路由中添加文件大小验证
router.post('/upload', (req, res) => {
    upload(req, res, async function (err) {
        console.log('开始处理上传请求');

        try {
            if (err) {
                throw new Error('文件上传错误: ' + err.message);
            }

            if (!req.files || !req.files.video || !req.files.audio) {
                throw new Error('缺少必要的文件');
            }

            const videoFile = req.files.video[0];
            const audioFile = req.files.audio[0];

            // 进行文件处理前的日志
            console.log('开始调用 AI 处理...');

            try {
                const messages = await processFilesAndCallAI(videoFile.path, audioFile.path);
                console.log('AI 处理返回的消息:', messages);

                // 清理文件
                await Promise.all([
                    fs.unlink(videoFile.path),
                    fs.unlink(audioFile.path)
                ]);

                res.json({
                    success: true,
                    message: '处理成功',
                    data: { messages }
                });
            } catch (processError) {
                console.error('AI 处理错误:', processError);
                throw processError;
            }

        } catch (error) {
            console.error('处理过程中出错:', error);
            // 清理文件
            if (req.files) {
                for (const field of ['video', 'audio']) {
                    if (req.files[field]) {
                        try {
                            await fs.unlink(req.files[field][0].path);
                        } catch (e) {
                            console.error(`清理${field}文件失败:`, e);
                        }
                    }
                }
            }

            res.status(500).json({
                success: false,
                message: '处理失败',
                error: error.message
            });
        }
    });
});
// 简单的文件类型验证函数
function isValidVideoFile(buffer) {
    // MP4 文件通常以 'ftyp' 标记开始
    return buffer.includes('ftyp');
}

function isValidAudioFile(buffer) {
    // WAV 文件通常以 'RIFF' 标记开始
    return buffer.includes('RIFF');
}

// 添加环境变量检查
const checkEnvironmentVariables = () => {
    const domain = process.env.VITE_APP_DOMAIN || 'https://api.zhipu.ai';
    const proxyPath = process.env.VITE_APP_PROXY_PATH || '/eastai';
    const apiKey = process.env.API_KEY || "d20c08612ef746beb7038a326131d475.cv71sxB0l7w8yOAO";

    console.log('环境变量检查:');
    console.log('VITE_APP_DOMAIN:', domain);
    console.log('VITE_APP_PROXY_PATH:', proxyPath);
    console.log('API_KEY:', apiKey ? '已设置' : '未设置');

    return { domain, proxyPath, apiKey };
};

async function processFilesAndCallAI(videoPath, audioPath) {
    try {
        console.log('开始 AI 处理流程...');

        // 修正环境变量的使用
        const domain = process.env.VITE_APP_DOMAIN || 'https://api.zhipu.ai';
        const proxyPath = process.env.VITE_APP_PROXY_PATH || '/eastai';  // 修正为正确的默认值
        const apiKey = process.env.VITE_APP_API_KEY;  // 使用相同的环境变量名

        // 检查环境变量
        console.log('环境变量检查:');
        console.log('DOMAIN:', domain);
        console.log('PROXY_PATH:', proxyPath);
        console.log('API_KEY 是否存在:', !!apiKey);

        const wsUrl = `${domain}${proxyPath}/v4/realtime?Authorization=${apiKey}`;
        console.log('WebSocket URL:', wsUrl.replace(/Authorization=.*$/, 'Authorization=***'));

        // 创建文件对象
        const videoFile = {
            name: videoPath.split('/').pop(),
            type: 'video/mp4',
            size: (await fs.stat(videoPath)).size,
            async arrayBuffer() {
                return await fs.readFile(videoPath);
            }
        };

        const audioFile = {
            name: audioPath.split('/').pop(),
            type: 'audio/wav',
            size: (await fs.stat(audioPath)).size,
            async arrayBuffer() {
                return await fs.readFile(audioPath);
            }
        };

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            let messages = [];
            let sessionUpdated = false;

            ws.on('open', async () => {
                try {
                    console.log('WebSocket 连接已建立');

                    // 1. 发送会话配置
                    console.log('发送会话配置...');
                    const sessionConfig = {
                        type: 'session.update',
                        session: {
                            turn_detection: {
                                type: 'client_vad',
                            },
                            beta_fields: {
                                chat_mode: 'video_passive',
                            },
                            output_audio_format: "mp3",
                            input_audio_format: "wav",
                        }
                    };
                    ws.send(JSON.stringify(sessionConfig));

                    // 2. 等待会话配置确认
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('等待会话配置超时'));
                        }, 5000);

                        const handler = (data) => {
                            const message = JSON.parse(data.toString());
                            if (message.type === 'session.updated') {
                                clearTimeout(timeout);
                                ws.removeListener('message', handler);
                                resolve();
                            }
                        };
                        ws.on('message', handler);
                    });

                    // 3. 处理和发送视频帧
                    console.log('开始处理视频帧...');
                    const videoFrames = await processVideoFrames(videoFile, (progress) => {
                        console.log(`视频处理进度: ${progress}%`);
                    });

                    console.log('开始发送视频帧...');
                    for (const { timestamp, frame } of videoFrames) {
                        ws.send(JSON.stringify({
                            type: 'video.append',
                            client_timestamp: timestamp,
                            video_frame: frame
                        }));
                    }
                    console.log('视频帧发送完成');

                    // 4. 等待确保视频帧发送完成
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // 5. 发送音频开始标记
                    console.log('发送音频开始标记...');
                    ws.send(JSON.stringify({
                        type: 'audio.start',
                        client_timestamp: Date.now()
                    }));

                    // 6. 处理并发送音频数据
                    console.log('开始处理音频...');
                    const audioBase64 = await readFileAsBase64(audioFile);
                    console.log('音频数据准备完成, 长度:', audioBase64.length);

                    ws.send(JSON.stringify({
                        type: 'audio.append',
                        client_timestamp: Date.now(),
                        audio: audioBase64,
                        role: 'user',
                        receive_voice: true
                    }));
                    console.log('音频数据发送完成');

                    // 7. 发送音频结束标记
                    console.log('发送音频结束标记...');
                    ws.send(JSON.stringify({
                        type: 'audio.end',
                        client_timestamp: Date.now()
                    }));

                    // 8. 等待后发送提交指令
                    await new Promise(resolve => setTimeout(resolve, 500));
                    console.log('发送提交指令...');
                    ws.send(JSON.stringify({
                        type: 'commit',
                        client_timestamp: Date.now()
                    }));
                    console.log('提交指令发送完成');

                } catch (error) {
                    console.error('处理过程中出错:', error);
                    ws.close();
                    reject(error);
                }
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log('收到 WebSocket 消息:', message.type);

                    switch (message.type) {
                        case 'response.audio_txt':
                        case 'response.text':
                            console.log('收到响应内容:', message.delta);
                            messages.push(message.delta);
                            break;

                        case 'response.audio_done':
                            console.log('AI 处理完成');
                            ws.close();
                            break;

                        case 'error':
                            console.error('收到错误消息:', message.error);
                            ws.close();
                            reject(new Error(message.error?.message || '处理失败'));
                            break;
                    }
                } catch (err) {
                    console.error('处理消息时出错:', err);
                    ws.close();
                    reject(err);
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket 错误:', error);
                reject(error);
            });

            ws.on('close', () => {
                console.log('WebSocket 连接已关闭');
                if (messages.length > 0) {
                    resolve(messages);
                } else {
                    reject(new Error('处理完成但没有收到任何消息'));
                }
            });
        });
    } catch (error) {
        console.error('AI 处理过程中出错:', error);
        throw error;
    }
}

// 在上传路由中调用 AI 处理
router.post('/upload', (req, res) => {
    upload(req, res, async function (err) {
        // ... 前面的错误处理代码保持不变 ...

        try {
            const videoFile = req.files.video[0];
            const audioFile = req.files.audio[0];

            console.log('开始处理文件并调用 AI 接口...');
            const messages = await processFilesAndCallAI(videoFile.path, audioFile.path);

            // 清理临时文件
            await Promise.all([
                fs.unlink(videoFile.path),
                fs.unlink(audioFile.path)
            ]);

            res.json({
                success: true,
                message: '处理成功',
                data: {
                    messages
                }
            });

        } catch (error) {
            console.error('AI 处理过程中出错:', error);
            // 清理临时文件
            if (req.files) {
                if (req.files.video) {
                    try {
                        await fs.unlink(req.files.video[0].path);
                    } catch (e) {
                        console.error('清理视频文件失败:', e);
                    }
                }
                if (req.files.audio) {
                    try {
                        await fs.unlink(req.files.audio[0].path);
                    } catch (e) {
                        console.error('清理音频文件失败:', e);
                    }
                }
            }
            res.status(500).json({
                success: false,
                message: '处理失败',
                error: error.message,
                code: 'AI_PROCESS_ERROR'
            });
        }
    });
});

export default router;