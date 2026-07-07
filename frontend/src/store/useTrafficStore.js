import { create } from 'zustand';

export const useTrafficStore = create((set) => ({
  currentTime: 0,             // 影片當前秒數 (全域時鐘的核心)
  isPlaying: false,           // 播放狀態
  activeFilter: 'all',        // 車種篩選: all, car, motorcycle, truck
  masterData: null,           // 存放後端撈取的完整結構化資料
  
  setCurrentTime: (time) => set({ currentTime: Math.floor(time) }),
  setIsPlaying: (status) => set({ isPlaying: status }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setMasterData: (data) => set({ masterData: data })
}));