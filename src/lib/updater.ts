import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// интервал между проверками (часы)
const HOURS = 6;
const MS = HOURS * 60 * 60 * 1000;

export function initUpdater() {
  // Проверяем сразу после старта
  maybeCheck();

  // и затем каждые N часов
  const timer = setInterval(maybeCheck, MS);

  // функция для отписки — вызывается при размонтировании компонента
  return () => clearInterval(timer);
}

async function maybeCheck() {
  try {
    // В версии 2 API возвращает объект обновления или undefined
    const update = await check();

    if (update) {
      console.log(
        `Найдена новая версия ${update.version} от ${update.date}. Начинаем загрузку…`,
      );

      // Скачивание + установка с отображением прогресса
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            console.log(`[updater] Начало загрузки. Всего байт: ${event.data.contentLength ?? 'неизвестно'}`);
            break;
          case 'Progress':
            console.log(`[updater] Скачано ${event.data.chunkLength} байт`);
            break;
          case 'Finished':
            console.log('[updater] Загрузка завершена, установка…');
            break;
        }
      });

      console.log('[updater] Обновление установлено, перезапуск приложения');
      await relaunch();
    }
  } catch (e) {
    console.error('Ошибка апдейтера:', e);
  }
}