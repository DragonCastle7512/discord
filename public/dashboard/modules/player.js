import { dashboardData, progressState } from './state.js';
import { showToast } from './ui.js';
import { api } from './api.js';

export function startProgressTimer() {
  if (progressState.progressInterval) clearInterval(progressState.progressInterval);

  progressState.progressInterval = setInterval(() => {
    if (!progressState.isPlaying || progressState.currentPos >= progressState.totalDuration) return;

    progressState.currentPos += 200;
    updateProgressBarUI();
  }, 200);
}

export function updateProgressBarUI() {
  const progressStart = document.querySelector('.progress-times span:first-child');
  const progressFill = document.querySelector('.progress-fill');
  const progressDot = document.querySelector('.progress-dot');

  if (progressStart) progressStart.textContent = formatTime(progressState.currentPos);

  const progress = (progressState.currentPos / (progressState.totalDuration || 1)) * 100;
  if (progressFill) progressFill.style.width = `${Math.min(progress, 100)}%`;
  if (progressDot) progressDot.style.left = `${Math.min(progress, 100)}%`;
}

export async function playMusic(url) {
  try {
    const result = await api.playMusic(url);
    if (result.ok) {
      showToast('성공적으로 재생을 요청했습니다.');
    }
    else {
      alert(result.message || '재생 요청에 실패했습니다.');
    }
  }
  catch (err) {
    console.error('재생 요청 오류:', err);
  }
}

export async function sendControl(action) {
  try {
    const result = await api.sendControl(action);
    if (result.ok) {
      const messages = {
        shuffle: '대기열을 무작위로 섞었습니다.',
        skip: '다음 곡으로 넘어갑니다.',
        previous: '이전 곡으로 돌아갑니다.',
        pause: '재생 상태를 변경했습니다.',
      };
      if (action === 'loop') {
        const loopMsg = result.enabled ? '반복 재생 모드를 활성화했습니다.' : '반복 재생 모드를 비활성화했습니다.';
        showToast(loopMsg);
      }
      else if (action === 'addPlaylist') {
        showToast(result.message || '플레이리스트에 곡을 추가했습니다.');
      }
      else if (messages[action]) {
        showToast(messages[action]);
      }
    }
    else {
      console.error(`${action} 실패:`, result.message);
      if (action === 'addPlaylist') {
        alert(result.message || '플레이리스트 추가에 실패했습니다.');
      }
    }
  }
  catch (err) {
    console.error(`${action} 요청 오류:`, err);
  }
}

export function formatTime(ms) {
  if (!ms) return '0:00';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}:${String(rem).padStart(2, '0')}`;
}

export function togglePlay() {
  const playIcon = document.getElementById('playIcon');
  const cm = dashboardData.musicInfo.currentMusic;
  if (!cm) return;

  sendControl('pause');
  if (playIcon) {
    const isPlayingIcon = playIcon.innerHTML.includes('rect');
    playIcon.replaceChildren();
    if (isPlayingIcon) {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', '5 3 19 12 5 21 5 3');
      playIcon.appendChild(poly);
    }
    else {
      const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r1.setAttribute('x', '6');
      r1.setAttribute('y', '4');
      r1.setAttribute('width', '4');
      r1.setAttribute('height', '16');
      const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r2.setAttribute('x', '14');
      r2.setAttribute('y', '4');
      r2.setAttribute('width', '4');
      r2.setAttribute('height', '16');
      playIcon.append(r1, r2);
    }
  }
}
