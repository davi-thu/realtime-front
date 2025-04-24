// 处理视频文件,提取帧
export async function processVideoFrames(videoFile, onProgress) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const frames = []
      
      video.src = URL.createObjectURL(videoFile)
      
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        
        // 设置提取帧的时间间隔(ms)
        const frameInterval = 200 // 每200ms提取一帧
        let currentTime = 0
        const duration = video.duration
        const totalFrames = Math.ceil(duration * 1000 / frameInterval)
        let processedFrames = 0
        
        function extractFrame() {
          if (currentTime <= duration) {
            video.currentTime = currentTime
            
            video.onseeked = () => {
              // 在Canvas上绘制当前视频帧
              ctx.drawImage(video, 0, 0)
              
              // 将帧转换为base64
              canvas.toBlob((blob) => {
                const reader = new FileReader()
                reader.onloadend = () => {
                  const base64data = reader.result.split(',')[1]
                  frames.push(base64data)
                  
                  processedFrames++
                  onProgress(Math.min(Math.floor(processedFrames / totalFrames * 100), 100))
                  
                  currentTime += frameInterval / 1000
                  if (processedFrames < totalFrames) {
                    extractFrame()
                  } else {
                    URL.revokeObjectURL(video.src)
                    resolve(frames)
                  }
                }
                reader.readAsDataURL(blob)
              }, 'image/jpeg', 0.8)
            }
          }
        }
        
        extractFrame()
      }
      
      video.onerror = (error) => {
        URL.revokeObjectURL(video.src)
        reject(new Error('视频文件加载失败: ' + error.message))
      }
    })
  }
  
  // 将文件转换为base64
  export function readFileAsBase64(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        onProgress(100)
        resolve(base64)
      }
      
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.floor((event.loaded / event.total) * 100)
          onProgress(progress)
        }
      }
      
      reader.onerror = () => reject(new Error('文件读取失败'))
      
      reader.readAsDataURL(file)
    })
  }

  