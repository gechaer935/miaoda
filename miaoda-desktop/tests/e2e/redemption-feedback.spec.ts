import { expect, test } from '@playwright/test';

test.describe('card redemption feedback', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const quota = {
        remainingInterviewSeconds: 3600,
        remainingWrittenQuestions: 30,
      };
      const authState = {
        isAuthenticated: true,
        authMode: 'account',
        username: 'test-user',
        quota,
      };
      let quotaChangedCallback: ((nextQuota: typeof quota) => void) | undefined;
      let logoutCalls = 0;
      const translationRequests: string[] = [];
      const interviewAnswerRequests: any[] = [];
      const assistantWindowResizeHeights: number[] = [];
      const interviewFailureModels: string[] = [];
      let failNextInterviewAnswer = false;
      let interviewAnswerDelayMs = 0;
      let interviewAnswerText = 'I use Redis. I monitor latency.';
      let transcriptCallback: ((payload: any) => void) | undefined;
      let speechStartedCallback: ((payload: any) => void) | undefined;
      let speechEndedCallback: ((payload: any) => void) | undefined;
      (window as any).__emitMiaodaQuotaChanged = (nextQuota: typeof quota) => quotaChangedCallback?.(nextQuota);
      (window as any).__getMiaodaLogoutCalls = () => logoutCalls;
      (window as any).__recognitionLanguages = [];
      (window as any).__translationRequests = translationRequests;
      (window as any).__interviewAnswerRequests = interviewAnswerRequests;
      (window as any).__getAssistantWindowResizeHeights = () => assistantWindowResizeHeights.slice();
      (window as any).__failNextInterviewAnswer = () => { failNextInterviewAnswer = true; };
      (window as any).__failInterviewModels = (models: string[]) => {
        interviewFailureModels.splice(0, interviewFailureModels.length, ...models);
      };
      (window as any).__setInterviewAnswerDelay = (delayMs: number) => { interviewAnswerDelayMs = delayMs; };
      (window as any).__setInterviewAnswerText = (text: string) => { interviewAnswerText = text; };
      (window as any).__emitInterviewTranscript = (payload: any) => transcriptCallback?.(payload);
      (window as any).__emitInterviewSpeechStarted = (payload: any) => speechStartedCallback?.(payload);
      (window as any).__emitInterviewSpeechEnded = (payload: any) => speechEndedCallback?.(payload);
      const bridge = {
        platform: 'win32',
        getThemeMode: async () => ({ resolved: 'light' }),
        getUndetectable: async () => false,
        getOverlayMousePassthrough: async () => false,
        getKeybinds: async () => [],
        miaodaAuthGetState: async () => authState,
        miaodaAuthGetQuota: async () => quota,
        miaodaAuthLogout: async () => {
          logoutCalls += 1;
          authState.isAuthenticated = false;
          return { isAuthenticated: false };
        },
        miaodaAccountRedeem: async () => ({
          authState,
          addedInterviewSeconds: 600,
          addedWrittenQuestions: 3,
        }),
        setRecognitionLanguage: async (key: string) => {
          (window as any).__recognitionLanguages.push(key);
          return { success: true };
        },
        miaodaInterviewAnswerStream: async (input: any, onToken: (token: string) => void) => {
          interviewAnswerRequests.push(input);
          if (failNextInterviewAnswer || interviewFailureModels[0] === input.model) {
            failNextInterviewAnswer = false;
            if (interviewFailureModels[0] === input.model) interviewFailureModels.shift();
            throw new Error('retryable stream failure');
          }
          if (interviewAnswerDelayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, interviewAnswerDelayMs));
          }
          const answer = interviewAnswerText;
          if (answer === 'I use Redis. I monitor latency.') {
            onToken('I use Redis. ');
            onToken('I monitor latency.');
          } else {
            onToken(answer);
          }
          return {
            answer,
            model: input.model === 'aliyun:qwen3.7-plus' ? 'qwen3.7-plus' : input.model,
          };
        },
        miaodaInterviewTranslateStream: async (input: { text: string }, onToken: (token: string) => void) => {
          translationRequests.push(input.text);
          const translations: Record<string, string> = {
            'How do you use Redis?': '你如何使用 Redis？',
            'I use Redis.': '我会使用 Redis。',
            'I monitor latency.': '我会监控延迟。',
            'I use Redis. I monitor latency.': '我会使用 Redis，并监控延迟。',
          };
          const translation = translations[input.text] || `译文：${input.text}`;
          const midpoint = Math.max(1, Math.floor(translation.length / 2));
          onToken(translation.slice(0, midpoint));
          onToken(translation.slice(midpoint));
          return { translation, model: 'qwen-mt-lite' };
        },
        startMeeting: async () => ({ success: true }),
        resizeAssistantWindow: async (height: number) => {
          assistantWindowResizeHeights.push(height);
          return { success: true, height };
        },
        onNativeAudioTranscript: (callback: (payload: any) => void) => {
          transcriptCallback = callback;
          return () => { if (transcriptCallback === callback) transcriptCallback = undefined; };
        },
        onNativeAudioSpeechStarted: (callback: (payload: any) => void) => {
          speechStartedCallback = callback;
          return () => { if (speechStartedCallback === callback) speechStartedCallback = undefined; };
        },
        onNativeAudioSpeechEnded: (callback: (payload: any) => void) => {
          speechEndedCallback = callback;
          return () => { if (speechEndedCallback === callback) speechEndedCallback = undefined; };
        },
        onThemeChanged: () => () => undefined,
        onUndetectableChanged: () => () => undefined,
        onOverlayMousePassthroughChanged: () => () => undefined,
        onKeybindsUpdate: () => () => undefined,
        onGlobalShortcut: () => () => undefined,
        onMiaodaQuotaChanged: (callback: (nextQuota: typeof quota) => void) => {
          quotaChangedCallback = callback;
          return () => {
            if (quotaChangedCallback === callback) quotaChangedCallback = undefined;
          };
        },
      };
      (window as any).electronAPI = new Proxy(bridge, {
        get(target, property) {
          if (property in target) return (target as any)[property];
          if (String(property).startsWith('on')) return () => () => undefined;
          return async () => undefined;
        },
      });
    });
    await page.goto('http://127.0.0.1:5180/');
  });

  test('button remains visible on hover and success opens a modal', async ({ page }) => {
    const input = page.getByLabel('兑换卡密');
    const button = page.getByRole('button', { name: '立即兑换' });

    await input.fill('MD-TEST-TEST-TEST');
    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(29, 78, 216)');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');

    await button.click();
    const dialog = page.getByRole('dialog', { name: '兑换成功' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('已增加面试 10 分钟、笔试 3 题');
    await expect(page.locator('.lite-card-redemption > p.success')).toHaveCount(0);
  });

  test('quota broadcast updates the already-open homepage immediately', async ({ page }) => {
    const quotaPill = page.locator('.lite-quota-pill');
    await expect(quotaPill).toContainText('面试 60 分钟  笔试 30 次');

    await page.evaluate(() => (window as any).__emitMiaodaQuotaChanged({
      remainingInterviewSeconds: 3480,
      remainingWrittenQuestions: 29,
    }));

    await expect(quotaPill).toContainText('面试 58 分钟  笔试 29 次');
  });

  test('logout sits beside the greeting and returns to the login screen', async ({ page }) => {
    const greeting = page.locator('.lite-hero-account');
    const logout = page.getByRole('button', { name: '退出登录' });

    await expect(greeting).toContainText('test-user');
    await expect(logout).toBeVisible();
    await logout.click();

    await expect(page.getByRole('heading', { name: '登录秒答' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__getMiaodaLogoutCalls())).toBe(1);
  });

  test('interview setup exposes Fun-ASR languages in readable groups', async ({ page }) => {
    await page.getByRole('button', { name: '进入配置' }).first().click();
    const languageSelect = page.getByLabel('面试语言');
    await expect(languageSelect.locator('optgroup')).toHaveCount(3);
    await expect(languageSelect.locator('option')).toHaveCount(37);
    await languageSelect.selectOption('slovak');
    await expect(languageSelect).toHaveValue('slovak');
    await expect(languageSelect.locator('option:checked')).toHaveText('Slovenčina');
  });

  test('interview translation remains off by default and exposes only complete translation for English', async ({ page }) => {
    await page.getByRole('button', { name: '进入配置' }).first().click();
    const languageSelect = page.getByLabel('面试语言');
    const translationSelect = page.getByLabel('选择面试翻译模式');

    await expect(translationSelect).toBeDisabled();
    await expect(translationSelect).toHaveValue('off');
    await languageSelect.selectOption('en');
    await expect(translationSelect).toBeEnabled();
    await expect(translationSelect.locator('option')).toHaveCount(2);
    await expect(translationSelect).not.toContainText('逐句翻译');
    await translationSelect.selectOption('complete');
    await expect(translationSelect).toHaveValue('complete');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lite_interview_translation_mode'))).toBe('complete');
  });

  test('removed sentence mode migrates to one complete-answer translation request', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('lite_interview_language', 'en');
      localStorage.setItem('lite_interview_translation_mode', 'sentence');
    });
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    await page.getByRole('button', { name: '手动提问' }).click();
    await page.getByLabel('手动输入面试问题').fill('How do you use Redis?');
    await page.getByRole('button', { name: '发送' }).click();

    const card = page.locator('.assistant-compact-answer-card').first();
    await expect(card.locator('.interview-translation.question')).toContainText('你如何使用 Redis？');
    await expect(card.locator('.interview-translation.answer')).toContainText('我会使用 Redis，并监控延迟。');
    await expect(card.getByText('题目翻译', { exact: true })).toHaveCount(0);
    await expect(card.getByText('中文翻译', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__translationRequests)).toEqual([
      'How do you use Redis?',
      'I use Redis. I monitor latency.',
    ]);
  });

  test('complete mode sends the finished answer in one translation request', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('lite_interview_language', 'en');
      localStorage.setItem('lite_interview_translation_mode', 'complete');
    });
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    await page.getByRole('button', { name: '手动提问' }).click();
    await page.getByLabel('手动输入面试问题').fill('How do you use Redis?');
    await page.getByRole('button', { name: '发送' }).click();

    const card = page.locator('.assistant-compact-answer-card').first();
    await expect(card.locator('.interview-translation.answer')).toContainText('我会使用 Redis，并监控延迟。');
    await expect.poll(() => page.evaluate(() => (window as any).__translationRequests)).toEqual([
      'How do you use Redis?',
      'I use Redis. I monitor latency.',
    ]);
  });

  test('standalone interview applies the selected recognition language before listening', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('lite_interview_language', 'croatian'));
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    await expect.poll(() => page.evaluate(() => (window as any).__recognitionLanguages)).toContain('croatian');
    await expect(page.locator('.assistant-compact-header-context')).toContainText('Hrvatski');
  });

  test('standalone interview sends the latest six completed turns as follow-up context', async ({ page }) => {
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    for (let index = 1; index <= 7; index += 1) {
      await page.getByRole('button', { name: '手动提问' }).click();
      await page.getByLabel('手动输入面试问题').fill(`Context question ${index}`);
      await page.getByRole('button', { name: '发送' }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(index);
    }

    const lastContext = await page.evaluate(() => {
      const requests = (window as any).__interviewAnswerRequests;
      return requests.at(-1).context;
    });
    expect(lastContext).toHaveLength(6);
    expect(lastContext[0]).toContain('Context question 1');
    expect(lastContext[5]).toContain('Context question 6');
  });

  test('standalone interview shows the latest one or two cards and fits settled content', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    const answerCount = page.locator('.assistant-compact-answer-count select');

    await expect(answerCount).toHaveValue('1');
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.assistant-compact-header');
      const select = document.querySelector<HTMLElement>('.assistant-compact-answer-count select');
      if (!header || !select) return false;
      const selectRect = select.getBoundingClientRect();
      return document.documentElement.scrollWidth <= window.innerWidth
        && header.scrollWidth <= header.clientWidth
        && selectRect.left >= 0
        && selectRect.right <= window.innerWidth;
    })).toBe(true);
    await page.evaluate(() => {
      (window as any).__setInterviewAnswerText(
        'A production-ready answer should explain the decision, the trade-offs, the failure modes, '
          + 'the observability signals, and the rollback strategy with a concrete example. '.repeat(3),
      );
    });
    await page.getByRole('button', { name: '手动提问' }).click();
    const questions = [
      'First retained interview question with enough detail to wrap across several lines in the compact answer card.',
      'Second retained interview question with enough detail to wrap across several lines in the compact answer card.',
      'Third and latest interview question with enough detail to wrap across several lines in the compact answer card.',
    ];
    for (let index = 0; index < questions.length; index += 1) {
      await page.getByLabel('手动输入面试问题').fill(questions[index]);
      await page.getByRole('button', { name: '发送' }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(index + 1);
      await expect(page.locator('.assistant-compact-manual-status')).not.toContainText('正在生成回答');
    }

    const cards = page.locator('.assistant-compact-answer-card:not(.live)');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(questions[2]);
    await expect(page.locator('.assistant-compact-answers')).not.toContainText(questions[0]);
    await expect(page.locator('.assistant-compact-answers')).not.toContainText(questions[1]);
    await expect.poll(() => page.evaluate(() => (
      (window as any).__getAssistantWindowResizeHeights().at(-1)
    ))).toBeGreaterThanOrEqual(410);
    const oneCardHeight = await page.evaluate(() => (
      (window as any).__getAssistantWindowResizeHeights().at(-1)
    ));

    await answerCount.selectOption('2');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText(questions[1]);
    await expect(cards.nth(1)).toContainText(questions[2]);
    await expect(page.locator('.assistant-compact-answers')).not.toContainText(questions[0]);
    await expect.poll(() => page.evaluate(() => (
      (window as any).__getAssistantWindowResizeHeights().at(-1)
    ))).toBeGreaterThan(oneCardHeight);
    const twoCardHeight = await page.evaluate(() => (
      (window as any).__getAssistantWindowResizeHeights().at(-1)
    ));
    expect(twoCardHeight).not.toBe(700);
    await page.setViewportSize({ width: 400, height: twoCardHeight });
    await expect.poll(() => page.evaluate(() => {
      const answers = document.querySelector<HTMLElement>('.assistant-compact-answers');
      return Boolean(answers && answers.scrollHeight <= answers.clientHeight + 2);
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => (
      window.localStorage.getItem('lite_interview_answer_view_count')
    ))).toBe('2');

    await page.reload();
    await expect(page.locator('.assistant-compact-answer-count select')).toHaveValue('2');
    await expect.poll(() => page.evaluate(() => (
      (window as any).__getAssistantWindowResizeHeights().at(-1)
    ))).toBe(410);
  });

  test('automatic interview gate ignores noise and late ASR revisions update one turn only', async ({ page }) => {
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    await page.locator('.assistant-compact-answer-count select').selectOption('2');
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      (window as any).__emitInterviewSpeechStarted({ speaker: 'interviewer', timestamp: Date.now() });
      (window as any).__emitInterviewTranscript({ speaker: 'interviewer', segmentId: 'noise-1', text: 'okay.', final: true });
      (window as any).__emitInterviewSpeechEnded({ speaker: 'interviewer', timestamp: Date.now() });
    });
    await page.waitForTimeout(1_800);
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(0);

    await page.evaluate(() => {
      (window as any).__emitInterviewSpeechStarted({ speaker: 'interviewer', timestamp: Date.now() });
      (window as any).__emitInterviewTranscript({ speaker: 'interviewer', segmentId: 'question-1', text: '为什么选择 Redis？', final: true });
      (window as any).__emitInterviewSpeechEnded({ speaker: 'interviewer', timestamp: Date.now() });
    });
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length), { timeout: 5_000 }).toBe(1);
    const request = await page.evaluate(() => (window as any).__interviewAnswerRequests[0]);
    expect(request.turnId).toMatch(/^interview-/);
    expect(request.pipelineId).toBeTruthy();
    expect(request.attemptId).toBe(0);

    await page.evaluate(() => {
      (window as any).__emitInterviewTranscript({
        speaker: 'interviewer',
        segmentId: 'question-1',
        text: '为什么在这个项目里选择 Redis 作为缓存？',
        final: true,
      });
    });
    await page.waitForTimeout(700);
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(1);
    await expect(page.locator('.assistant-compact-answer-card').first()).toContainText('为什么在这个项目里选择 Redis 作为缓存？');

    await page.evaluate(() => {
      (window as any).__emitInterviewSpeechStarted({ speaker: 'interviewer', timestamp: Date.now() });
      (window as any).__emitInterviewTranscript({ speaker: 'interviewer', segmentId: 'question-2', text: '事务隔离级别有哪些？', final: true });
      (window as any).__emitInterviewSpeechEnded({ speaker: 'interviewer', timestamp: Date.now() });
    });
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length), { timeout: 5_000 }).toBe(2);

    await page.evaluate(() => {
      (window as any).__emitInterviewTranscript({
        speaker: 'interviewer',
        segmentId: 'question-1',
        text: '为什么在这个项目里选择 Redis 作为缓存，而不是本地缓存？',
        final: true,
      });
    });
    await page.waitForTimeout(700);
    const cards = page.locator('.assistant-compact-answer-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('为什么在这个项目里选择 Redis 作为缓存，而不是本地缓存？');
    await expect(cards.nth(1)).toContainText('事务隔离级别有哪些？');
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(2);
  });

  test('standalone interview retries one failed Flash stream before falling back', async ({ page }) => {
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    await page.evaluate(() => (window as any).__failNextInterviewAnswer());
    await page.getByRole('button', { name: '手动提问' }).click();
    await page.getByLabel('手动输入面试问题').fill('Retry this interview answer');
    await page.getByRole('button', { name: '发送' }).click();

    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(2);
    const models = await page.evaluate(() => (
      (window as any).__interviewAnswerRequests.map((request: any) => request.model)
    ));
    expect(models).toEqual(['deepseek-v4-flash', 'deepseek-v4-flash']);
    await expect(page.locator('.assistant-compact-answer-card').first()).toContainText('I monitor latency.');
  });

  test('interview switches to Qwen for the session and returns to DeepSeek if Qwen fails', async ({ page }) => {
    await page.goto('http://127.0.0.1:5180/?window=assistant-interview');
    await page.evaluate(() => {
      (window as any).__failInterviewModels([
        'deepseek-v4-flash',
        'deepseek-v4-flash',
        'deepseek-v4-pro',
      ]);
      (window as any).__setInterviewAnswerDelay(600);
    });

    await page.getByRole('button', { name: '手动提问' }).click();
    await page.getByLabel('手动输入面试问题').fill('Use the Qwen backup');
    await page.getByRole('button', { name: '发送' }).click();

    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(4);
    await expect(page.locator('.assistant-compact-answer-card').first()).toContainText('调用大模型失败，正在切换…');
    await expect(page.locator('.assistant-compact-answer-card').first()).toContainText('I monitor latency.');
    await expect.poll(() => page.evaluate(() => (
      (window as any).__interviewAnswerRequests.slice(0, 4).map((request: any) => request.model)
    ))).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'aliyun:qwen3.7-plus',
    ]);

    await page.evaluate(() => (window as any).__setInterviewAnswerDelay(0));
    await page.getByRole('button', { name: '手动提问' }).click();
    await page.getByLabel('手动输入面试问题').fill('Keep using Qwen');
    await page.getByRole('button', { name: '发送' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(5);
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests[4].model)).toBe('aliyun:qwen3.7-plus');

    await page.evaluate(() => (window as any).__failInterviewModels(['aliyun:qwen3.7-plus']));
    await page.getByRole('button', { name: '手动提问' }).click();
    await page.getByLabel('手动输入面试问题').fill('Return to DeepSeek');
    await page.getByRole('button', { name: '发送' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(7);
    await expect.poll(() => page.evaluate(() => (
      (window as any).__interviewAnswerRequests.slice(5, 7).map((request: any) => request.model)
    ))).toEqual(['aliyun:qwen3.7-plus', 'deepseek-v4-flash']);

    await page.getByRole('button', { name: '手动提问' }).click();
    await page.getByLabel('手动输入面试问题').fill('Stay on DeepSeek');
    await page.getByRole('button', { name: '发送' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests.length)).toBe(8);
    await expect.poll(() => page.evaluate(() => (window as any).__interviewAnswerRequests[7].model)).toBe('deepseek-v4-flash');
  });
});
