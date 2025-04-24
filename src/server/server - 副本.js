import express from 'express';
import multer from 'multer';
import { WebSocket } from 'ws';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
        
        if (err instanceof multer.MulterError) {
            console.error('Multer 错误:', err);
            return res.status(400).json({
                success: false,
                message: '上传失败',
                error: err.message,
                code: 'MULTER_ERROR'
            });
        } else if (err) {
            console.error('其他错误:', err);
            return res.status(400).json({
                success: false,
                message: '上传失败',
                error: err.message,
                code: 'UPLOAD_ERROR'
            });
        }

        try {
            if (!req.files || !req.files.video || !req.files.audio) {
                console.error('缺少必要的文件');
                return res.status(400).json({
                    success: false,
                    message: '缺少必要的文件',
                    receivedFiles: req.files,
                    code: 'MISSING_FILES'
                });
            }

            const videoFile = req.files.video[0];
            const audioFile = req.files.audio[0];

            console.log('成功接收文件:');
            console.log('视频文件:', {
                path: videoFile.path,
                size: videoFile.size,
                mimetype: videoFile.mimetype
            });
            console.log('音频文件:', {
                path: audioFile.path,
                size: audioFile.size,
                mimetype: audioFile.mimetype
            });

            // 检查文件大小
            const videoStats = await fs.stat(videoFile.path);
            const audioStats = await fs.stat(audioFile.path);

            console.log('文件系统大小检查:');
            console.log('视频文件大小:', videoStats.size);
            console.log('音频文件大小:', audioStats.size);

            // 验证文件大小是否合理
            if (videoStats.size < 1024) { // 小于 1KB
                throw new Error('视频文件大小异常');
            }
            if (audioStats.size < 1024) { // 小于 1KB
                throw new Error('音频文件大小异常');
            }

            // 读取文件头部来验证文件类型
            const videoBuffer = await fs.readFile(videoFile.path, { length: 4096 });
            const audioBuffer = await fs.readFile(audioFile.path, { length: 4096 });

            // 简单的文件类型验证
            if (!isValidVideoFile(videoBuffer)) {
                throw new Error('无效的视频文件格式');
            }
            if (!isValidAudioFile(audioBuffer)) {
                throw new Error('无效的音频文件格式');
            }

            res.json({
                success: true,
                message: '文件上传成功',
                data: {
                    video: {
                        filename: videoFile.filename,
                        size: videoStats.size,
                        mimetype: videoFile.mimetype
                    },
                    audio: {
                        filename: audioFile.filename,
                        size: audioStats.size,
                        mimetype: audioFile.mimetype
                    }
                }
            });

        } catch (error) {
            console.error('处理过程中出错:', error);
            // 清理可能已上传的文件
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
                code: 'PROCESS_ERROR'
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

export default router;