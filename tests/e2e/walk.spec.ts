import { test, expect } from '@playwright/test';

test.describe('True User Simulation: Forest Walk', () => {
  test('User can open app, get location, and find mushroom', async ({ page }) => {
    // 1. Открываем наше приложение (Эмуляция живого человека)
    await page.goto('/');

    // 2. Нажимаем кнопку "В Лес!"
    await page.waitForSelector('#startBtn');
    await page.click('#startBtn');

    // 3. Ждем, пока карта загрузится и станет видимой
    await page.waitForSelector('#map', { state: 'visible' });

    // 5. Ждем пока GPS трекер загорится (эмуляция ожидания спутников)
    await expect(page.locator('#gpsDot')).toHaveClass(/active/);

    // 6. Человек находит гриб и нажимает кнопку (Приседает)
    await page.click('button:has-text("Нашел Гриб!")');

    // 7. Появляется Toast-уведомление
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('Точка сохранена');

    // 8. Переходим в статистику и проверяем, что счетчик грибов вырос
    await page.click('button:has-text("📊")'); // Кнопка статы
    await expect(page.locator('#statTotal')).not.toHaveText('0');
  });
});
