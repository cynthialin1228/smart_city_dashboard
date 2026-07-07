import React, { useRef, useEffect } from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function CustomVideoPlayer() {
  const videoRef = useRef(null);
  const { setCurrentTime, setIsPlaying, currentTime } = useTrafficStore();

  // 當使用者點擊下方 20 分鐘大折線圖跳轉時間時，直接精準同步影片進度
  useEffect(() => {
    if (videoRef.current && Math.abs(videoRef.current.currentTime - currentTime) > 1.5) {
      videoRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  return (
    <video
      ref={videoRef}
      src="http://localhost:8000/static/traffic_video.mp4"
      controls
      className="w-full h-full rounded-lg object-contain"
      onTimeUpdate={() => {
        if (videoRef.current) {
          // 1:1 真實時間投射，影片幾秒就是全域幾秒
          setCurrentTime(videoRef.current.currentTime);
        }
      }}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
    />
  );
}

export default CustomVideoPlayer;