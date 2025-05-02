import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { writable } from 'svelte/store';

// Состояние проверки обновлений
export const updateStatus = writable({
  checking: false,
  available: false,
  version: '',
  releaseDate: '',
  error: '',
  downloading: false,
  progress: 0
});

// Время последней проверки
let lastCheckTime = 0;
// Интервал между проверками при фокусе (1 час в миллисекундах)
const CHECK_INTERVAL = 60 * 60 * 1000;

// Инициализация проверки обновлений
export function initUpdater() {
  checkOnFocus();

  // Проверяем на фокусе окна
  window.addEventListener('focus', checkOnFocus);
  
  // Вернём функцию очистки
  return () => {
    window.removeEventListener('focus', checkOnFocus);
  };
}

// Проверка обновлений при фокусе окна
function checkOnFocus() {
  const now = Date.now();
  
  // Проверяем только если прошло достаточно времени с момента последней проверки
  if (now - lastCheckTime > CHECK_INTERVAL) {
    checkForUpdates();
  }
}

// Основная функция проверки обновлений
export async function checkForUpdates() {
  try {
    // Обновляем статус
    updateStatus.set({
      checking: true,
      available: false,
      version: '',
      releaseDate: '',
      error: '',
      downloading: false,
      progress: 0
    });
    
    // Запоминаем время проверки
    lastCheckTime = Date.now();
    
    // Проверяем наличие обновлений
    const update = await check();
    
    if (update) {
      // Есть новая версия
      updateStatus.set({
        checking: false,
        available: true,
        version: update.version || '',
        releaseDate: update.date || '',
        error: '',
        downloading: false,
        progress: 0
      });
      return update;
    } else {
      // Обновлений нет
      updateStatus.set({
        checking: false,
        available: false,
        version: '',
        releaseDate: '',
        error: '',
        downloading: false,
        progress: 0
      });
      return null;
    }
  } catch (err) {
    // Ошибка при проверке
    updateStatus.set({
      checking: false,
      available: false,
      version: '',
      releaseDate: '',
      error: String(err),
      downloading: false,
      progress: 0
    });
    console.error('Ошибка при проверке обновлений:', err);
    return null;
  }
}

// Функция для установки обновления
export async function installUpdate(update: Update | null) {
  if (!update) return;
  
  try {
    // Устанавливаем статус загрузки
    updateStatus.update(state => ({ ...state, downloading: true, progress: 0, error: '' }));
    
    // Скачиваем и устанавливаем обновление с отслеживанием прогресса
    await update.downloadAndInstall((progressEvent) => {
      // Для события прогресса устанавливаем процент загрузки
      if (progressEvent.event === 'Progress') {
        // Получаем текущий прогресс (0-100)
        const percentage = Math.min(
          Math.round((progressEvent.data.chunkLength / 100) * 100), 
          100
        );
        updateStatus.update(state => ({ ...state, progress: percentage }));
      }
    });
    
    // Перезапускаем приложение
    await relaunch();
  } catch (err) {
    console.error('Ошибка при установке обновления:', err);
    updateStatus.update(state => ({ 
      ...state, 
      error: String(err),
      downloading: false,
      progress: 0
    }));
  }
}

// Функция для сброса ошибки
export function clearUpdateError() {
  updateStatus.update(state => ({ ...state, error: '' }));
}