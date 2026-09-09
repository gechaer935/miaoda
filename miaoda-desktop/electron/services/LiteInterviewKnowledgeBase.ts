import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface KnowledgeMatch {
  matched: boolean;
  question: string;
  answer: string;
  score: number;
  elapsedMs: number;
  keywordHits: string[];
  source?: string;
}

interface KnowledgeItem {
  question: string;
  answer: string;
  source?: string;
  file?: string;
  normalizedQuestion: string;
  keywords: string[];
}

const WEAK_KEYWORDS = new Set([
  '什么', '怎么', '如何', '为什么', '哪些', '问题', '方法', '建议', '区别', '作用', '原因',
]);

const SYNONYMS: Array<[RegExp, string]> = [
  [/为啥|为什么要|有什么用|用来干嘛|解决什么问题|意义|目的/g, '作用'],
  [/怎么做|怎么办|如何处理|如何解决|解决办法|应对/g, '怎么解决'],
  [/不同|差异|对比|相比|区别/g, '区别'],
  [/同学|学生|大家/g, '学生'],
  [/班会|班级会|主题班会/g, '班会'],
  [/请假条|假条|请病假|请事假/g, '请假'],
  [/奖助学金|奖学金|助学金|评优/g, '奖学金评定'],
  [/保研|考研|升学/g, '升学'],
  [/就业|找工作|秋招|春招|实习/g, '就业实习'],
  [/项目经历|项目经验|作品集/g, '项目'],
  [/心理压力|焦虑|压力大|情绪/g, '压力'],
  [/thread/gi, '线程'],
  [/process/gi, '进程'],
  [/virtual memory/gi, '虚拟内存'],
  [/kernel mode/gi, '内核态'],
  [/user mode/gi, '用户态'],
];

const BUILT_IN_KNOWLEDGE: Array<{ question: string; answer: string; source: string }> = [
  {
    question: '刚开学不知道怎么适应大学生活怎么办？',
    answer: '先把作息、课程表和班级通知渠道稳定下来。第一周重点不是把所有事都做到最好，而是确认上课地点、作业提交方式、班委和辅导员联系方式。\n\n可以给自己设一个两周适应期：每天固定时间看通知，按课程建立文件夹或笔记本，遇到选课、宿舍、学习节奏问题及时找班委或老师确认。不要把不熟悉误解成自己不行。',
    source: 'built-in',
  },
  {
    question: '大学课程跟不上应该怎么办？',
    answer: '先判断是基础薄弱、听课方法不对，还是时间安排被其他事情挤占。不要只说“我跟不上”，要把问题拆成听不懂、作业不会、复习没时间、考试不知道重点。\n\n处理方式是三步：课前看目录和关键词，课堂先抓主线，课后当天补齐例题。连续两周仍吃力，就找任课老师、助教或学习委员要建议，尽早补基础。',
    source: 'built-in',
  },
  {
    question: '班级活动和学习冲突怎么办？',
    answer: '优先级看是否影响课程、考试和硬性任务。班级活动的目的不是占用大家时间，而是建立信息互通和班级支持网络。\n\n如果确实冲突，可以提前说明原因，能调换任务就调换，不能参加就补做必要的班级事务。关键是提前沟通，不要临时失联。',
    source: 'built-in',
  },
  {
    question: '想转专业应该怎么准备？',
    answer: '先确认学校当年的转专业政策，包括成绩要求、报名时间、考核科目、名额限制和是否允许跨学院。政策每年可能调整，不能只听学长学姐经验。\n\n准备上重点做两件事：保持当前专业成绩不掉队，同时补目标专业的基础课。转专业不是逃离当前困难，而是证明自己有能力进入新方向。',
    source: 'built-in',
  },
  {
    question: '考研和就业应该怎么选？',
    answer: '先看目标，不要只看别人怎么选。考研更适合希望进入研究型、专业门槛更高或学历要求明显的方向；就业更适合已经有明确岗位目标、愿意尽早积累行业经验的同学。\n\n可以用一个现实标准判断：你是否知道自己为什么考、考什么学校专业、失败后怎么办。如果这三个问题都模糊，就先做信息收集和实习/项目体验，再决定。',
    source: 'built-in',
  },
  {
    question: '没有项目经历怎么找实习？',
    answer: '先把课程作业、实验、竞赛、小工具整理成可展示的项目。项目不一定一开始就很大，但要能说明你解决了什么问题、用了什么方法、你负责哪一部分。\n\n接下来按岗位要求补短板：技术岗准备代码仓库和项目复盘，运营/产品岗准备调研、数据分析或活动案例。简历里不要堆名词，要写结果和证据。',
    source: 'built-in',
  },
  {
    question: '奖学金和评优主要看什么？',
    answer: '一般会看学习成绩、综合测评、纪律情况、竞赛科研、志愿服务和班级贡献。具体比例以学院当年文件为准。\n\n建议同学们平时保留证书、证明、活动记录和成果截图，评定前按要求提交材料。对结果有疑问可以按流程复核，但要基于规则和证据沟通。',
    source: 'built-in',
  },
  {
    question: '请假流程应该怎么走？',
    answer: '请假要提前申请，说明时间、原因、去向和联系方式。病假通常需要医疗证明，事假要写清必要性；离校或跨市更要按学院规定审批。\n\n不要事后补假、不要让同学口头代传。请假期间仍要自己跟进课程、作业和班级通知，返校后及时销假。',
    source: 'built-in',
  },
  {
    question: '宿舍矛盾怎么处理？',
    answer: '先把问题具体化：作息、卫生、噪音、公共物品还是沟通方式。不要在情绪最激动时扩大冲突，也不要长期忍着不说。\n\n建议先宿舍内部约定明确规则，比如熄灯后音量、值日表、公共区域使用。如果沟通无效，及时找班委、辅导员或宿管介入，目标是解决规则问题，不是评判谁“人不好”。',
    source: 'built-in',
  },
  {
    question: '学习压力很大怎么办？',
    answer: '先把压力来源写出来：课程、考试、家庭期待、人际关系还是未来选择。压力被说清楚以后，才容易找到处理方式。\n\n短期可以先恢复睡眠、运动和任务拆分；长期要建立稳定节奏。如果已经出现持续失眠、明显情绪低落或无法正常学习生活，应尽快联系辅导员、心理中心或专业帮助。',
    source: 'built-in',
  },
  {
    question: '班级通知太多容易漏怎么办？',
    answer: '建立固定的信息检查习惯。建议每天固定两个时间看班群、课程群和教务系统，把重要截止时间同步到日历。\n\n班委发通知时尽量包含对象、时间、地点、材料、截止时间和联系人。同学如果没看懂，直接问清楚，不要靠猜。',
    source: 'built-in',
  },
  {
    question: '如何准备竞赛？',
    answer: '先选和专业方向、时间投入匹配的竞赛，不要一开始盲目报名太多。看清赛题、评分标准、往届作品和报名节点。\n\n组队时要明确分工、交付物和每周进度。竞赛真正有价值的部分不是奖项本身，而是你能沉淀出项目、能力证明和复盘材料。',
    source: 'built-in',
  },
  {
    question: '进程和线程有什么区别？',
    answer: '进程是资源分配的基本单位，线程是 CPU 调度执行的基本单位。\n\n进程之间地址空间相互独立，隔离性更好，但创建和切换开销更大；同一进程内的线程共享地址空间和资源，通信更方便，切换更轻量，但也更容易出现竞态条件。\n\n一句话概括：进程强调隔离和稳定，线程强调轻量并发和执行效率。',
    source: 'built-in',
  },
  {
    question: '什么是虚拟内存？',
    answer: '虚拟内存是操作系统给每个进程提供的一层抽象地址空间，让进程看起来拥有连续、独立的内存。\n\n它主要解决三个问题：进程隔离、按页映射带来的灵活内存管理，以及通过换页让程序可用地址空间大于实际物理内存。代价是地址转换和缺页处理会有开销，所以系统会用 TLB、页面置换算法和局部性原理优化。',
    source: 'built-in',
  },
  {
    question: '死锁是什么，怎么避免？',
    answer: '死锁是多个线程或进程相互等待对方持有的资源，导致谁都无法继续执行。\n\n经典四个必要条件是互斥、占有且等待、不可抢占、循环等待。避免死锁通常就是破坏其中一个条件，比如统一加锁顺序、申请不到锁就释放已持有资源、给锁设置超时，或者减少持锁时间。',
    source: 'built-in',
  },
  {
    question: 'select、poll 和 epoll 有什么区别？',
    answer: '它们都是 I/O 多路复用机制，用来让一个线程同时监听多个连接。\n\nselect 和 poll 每次调用都需要把关注的文件描述符集合交给内核，返回后还要遍历查找就绪连接；epoll 把关注列表维护在内核里，通过事件回调把就绪 fd 放进队列，减少重复拷贝和全量遍历，所以更适合高并发网络服务。',
    source: 'built-in',
  },
];

function cleanQuestion(text: string): string {
  return String(text || '')
    .replace(/^\s*(?:\d+[.)、]\s*)+/, '')
    .replace(/^\s*(?:Q|问题|题目)[:：\s]*/i, '')
    .trim();
}

function normalizeText(text: string): string {
  let value = cleanQuestion(text).toLowerCase();
  for (const [pattern, replacement] of SYNONYMS) value = value.replace(pattern, replacement);
  return value
    .replace(/[`*_>#\[\](){}"'“”‘’.,，。:：;；!?！？、\s-]+/g, '')
    .trim();
}

function extractKeywords(text: string): Set<string> {
  const normalized = normalizeText(text);
  const words = new Set<string>();
  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}/gi)) {
    const token = match[0].toLowerCase();
    if (token.length >= 2) words.add(token);
  }
  for (const [, replacement] of SYNONYMS) {
    if (normalized.includes(replacement)) words.add(replacement);
  }
  return words;
}

function bigrams(text: string): Set<string> {
  const value = normalizeText(text);
  const set = new Set<string>();
  for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2));
  return set;
}

function overlapScore(aSet: Set<string>, bSet: Set<string>): number {
  if (!aSet.size || !bSet.size) return 0;
  let hit = 0;
  for (const item of aSet) if (bSet.has(item)) hit += 1;
  return hit / Math.max(aSet.size, bSet.size);
}

function keywordHits(a: string, keywords: string[]): string[] {
  const aKeywords = extractKeywords(a);
  const bKeywords = new Set(keywords);
  return [...aKeywords].filter(item => bKeywords.has(item));
}

function similarity(a: string, item: KnowledgeItem): number {
  const x = normalizeText(a);
  const y = item.normalizedQuestion;
  if (!x || !y) return 0;

  const containScore = x.includes(y) || y.includes(x)
    ? Math.min(x.length, y.length) / Math.max(x.length, y.length)
    : 0;
  const bigramScore = overlapScore(bigrams(x), bigrams(y));
  const keywordScore = overlapScore(extractKeywords(a), new Set(item.keywords));

  return Math.max(containScore, bigramScore * 0.52 + keywordScore * 0.48);
}

function isStrongMatch(question: string, item: KnowledgeItem, score: number, threshold: number): boolean {
  if (score >= 0.84) return true;
  if (score < threshold) return false;
  const hits = keywordHits(question, item.keywords);
  const hasSpecificHit = hits.some(keyword => !WEAK_KEYWORDS.has(keyword));
  return score >= 0.66 && hasSpecificHit && hits.length >= 1;
}

function parseJsonKnowledge(raw: string): Array<{ question: string; answer: string; source?: string }> {
  const data = JSON.parse(raw);
  const rows = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
  return rows.map((item: any) => ({
    question: cleanQuestion(item.question || item.q || item.title || ''),
    answer: String(item.answer || item.a || item.content || '').trim(),
    source: item.source || 'json',
  })).filter((item: { question: string; answer: string; source?: string }) => item.question && item.answer);
}

function parseMarkdownKnowledge(raw: string): Array<{ question: string; answer: string; source?: string }> {
  const items: Array<{ question: string; answer: string; source?: string }> = [];
  const blocks = raw.split(/\r?\n(?=#{1,6}\s+)/g);
  for (const block of blocks) {
    const match = block.match(/^#{1,6}\s+(.+?)\s*\r?\n([\s\S]+)/);
    if (match) {
      items.push({ question: cleanQuestion(match[1]), answer: match[2].trim(), source: 'markdown' });
    }
  }

  const qaRegex = /(?:^|\n)\s*(?:Q|问题|题目)[:：\s]*(.+?)\s*\n\s*(?:A|答案|回答)[:：\s]*([\s\S]*?)(?=\n\s*(?:Q|问题|题目)[:：\s]|\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = qaRegex.exec(raw))) {
    items.push({ question: cleanQuestion(match[1]), answer: match[2].trim(), source: 'qa' });
  }
  return items.filter(item => item.question && item.answer);
}

function uniqueFiles(files: string[]): string[] {
  return [...new Set(files.map(file => path.resolve(file)).filter(file => fs.existsSync(file)))];
}

function listKnowledgeFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(name => /\.(md|txt|json)$/i.test(name))
      .map(name => path.join(dir, name));
  } catch {
    return [];
  }
}

export class LiteInterviewKnowledgeBase {
  private static instance: LiteInterviewKnowledgeBase;
  private items: KnowledgeItem[] = [];
  private filesKey = '';
  private mtimeKey = '';
  private loadedFiles: string[] = [];

  public static getInstance(): LiteInterviewKnowledgeBase {
    if (!LiteInterviewKnowledgeBase.instance) {
      LiteInterviewKnowledgeBase.instance = new LiteInterviewKnowledgeBase();
    }
    return LiteInterviewKnowledgeBase.instance;
  }

  public reload(): void {
    this.load(true);
  }

  public match(question: string, threshold = 0.66): KnowledgeMatch | null {
    const startedAt = Date.now();
    const query = cleanQuestion(question);
    if (!query) return null;
    const items = this.load(false);
    let best: { item: KnowledgeItem; score: number; hits: string[] } | null = null;
    for (const item of items) {
      const score = similarity(query, item);
      const hits = keywordHits(query, item.keywords);
      if (!best || score > best.score) best = { item, score, hits };
    }
    if (!best || !isStrongMatch(query, best.item, best.score, threshold)) return null;
    return {
      matched: true,
      question: best.item.question,
      answer: best.item.answer,
      score: Number(best.score.toFixed(3)),
      elapsedMs: Date.now() - startedAt,
      keywordHits: best.hits,
      source: best.item.file || best.item.source,
    };
  }

  public count(): number {
    return this.load(false).length;
  }

  public info(): { count: number; files: string[] } {
    this.load(false);
    return { count: this.items.length, files: [...this.loadedFiles] };
  }

  private candidateFiles(): string[] {
    const candidates = [
      path.join(app.getPath('userData'), 'lite-knowledge'),
      path.join(process.cwd(), 'knowledge'),
      path.join(app.getAppPath(), 'knowledge'),
      app.isPackaged ? path.join(process.resourcesPath, 'knowledge') : '',
      app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'knowledge') : '',
    ].filter(Boolean);
    return uniqueFiles(candidates.flatMap(listKnowledgeFiles));
  }

  private fileMtimeKey(files: string[]): string {
    return files.map(file => {
      try {
        const stat = fs.statSync(file);
        return `${file}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${file}:missing`;
      }
    }).join('|');
  }

  private addRows(rows: Array<{ question: string; answer: string; source?: string }>, items: KnowledgeItem[], file?: string): void {
    for (const row of rows) {
      const question = cleanQuestion(row.question);
      if (!question || !row.answer.trim()) continue;
      const dedupeKey = normalizeText(question);
      if (items.some(existing => existing.normalizedQuestion === dedupeKey)) continue;
      items.push({
        ...row,
        file,
        question,
        normalizedQuestion: dedupeKey,
        keywords: [...extractKeywords(question)],
      });
    }
  }

  private load(force: boolean): KnowledgeItem[] {
    const files = this.candidateFiles();
    const filesKey = files.join('|');
    const mtimeKey = this.fileMtimeKey(files);
    if (!force && this.filesKey === filesKey && this.mtimeKey === mtimeKey) return this.items;

    const items: KnowledgeItem[] = [];
    this.addRows(BUILT_IN_KNOWLEDGE, items);

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const rows = file.toLowerCase().endsWith('.json') ? parseJsonKnowledge(raw) : parseMarkdownKnowledge(raw);
        this.addRows(rows, items, file);
      } catch (error: any) {
        console.warn(`[LiteInterviewKnowledgeBase] Failed to read ${file}:`, error?.message || error);
      }
    }

    this.items = items;
    this.loadedFiles = files;
    this.filesKey = filesKey;
    this.mtimeKey = mtimeKey;
    console.log(`[LiteInterviewKnowledgeBase] Loaded ${items.length} items from ${files.length} file(s)`);
    return this.items;
  }
}
