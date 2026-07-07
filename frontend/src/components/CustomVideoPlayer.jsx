import React, { useRef, useEffect } from 'react';
import { useTrafficStore } from '../store/useTrafficStore';

function CustomVideoPlayer() {
  const videoRef = useRef(null);
  const { setCurrentTime, setIsPlaying, currentTime } = useTrafficStore();

  // 監聽全域時間軸變更 (例如使用者點擊折線圖跳轉)
  useEffect(() => {
    if (videoRef.current && Math.abs(videoRef.current.currentTime - currentTime) > 1) {
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
        if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
      }}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
    />
  );
}

export default CustomVideoPlayer;