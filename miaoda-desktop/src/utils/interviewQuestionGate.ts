export type InterviewQuestionGateDecision = 'answer' | 'defer' | 'ignore';

export type InterviewQuestionGateResult = {
  decision: InterviewQuestionGateDecision;
  reason: string;
  normalized: string;
};

export type InterviewQuestionGateOptions = {
  /** A deferred fragment has already received its extra settling window. */
  settled?: boolean;
};

const EXACT_NON_QUESTIONS = new Set([
  'ok', 'okay', 'k', 'hmm', 'hm', 'uh', 'um', 'oh', 'yes', 'no', 'yeah', 'yep',
  'right', 'sure', 'well', 'gotit', 'thankyou', 'thanks', 'hello', 'hi', 'bye',
  'what',
  '嗯', '嗯嗯', '呃', '额', '哦', '噢', '啊', '唉', '诶', '哎', '好', '好的',
  '行', '可以', '对', '对的', '是', '是的', '不是', '没错', '知道了', '明白',
  '我知道', '我知道了', '谢谢', '你好', '再见', '你', '你你', '我', '他', '她',
  '这', '那', '这个', '那个', '然后', '就是',
]);

const TECHNICAL_TOPIC = /(?:\b(?:java|python|c\+\+|golang|javascript|typescript|react|vue|spring|springboot|mybatis|redis|mysql|postgresql|mongodb|kafka|rocketmq|docker|kubernetes|k8s|jvm|gc|hashmap|arraylist|concurrenthashmap|volatile|synchronized|cas|aqs|sql|linux|tcp|udp|https?|tls|rpc|grpc|rest|oauth|jwt|git|maven|gradle|fcn|garbage collection|dependency injection|polymorphism|deadlock|database index|transaction isolation|event loop|memory model|design pattern|message queue|data structure|time complexity|space complexity)\b|线程池|线程安全|多线程|并发|进程|协程|死锁|乐观锁|悲观锁|分布式锁|事务|索引|数据库|缓存|消息队列|网络协议|数据结构|算法|链表|数组|二叉树|红黑树|B\+?树|堆(?:排序)?|栈|队列|图算法|时间复杂度|空间复杂度|微服务|分布式|一致性|幂等|熔断|限流|类加载|反射|动态代理|设计模式|垃圾回收|内存模型|内存泄漏|接口|单元测试|自动化测试|云原生|容器|编译器|操作系统)/iu;

const PERSONAL_INTERVIEW_TOPIC = /(?:自我介绍|项目经历|项目难点|项目里.{0,10}(?:最大|困难|问题|挑战)|最有挑战|优点|缺点|优势|不足|职业规划|未来.{0,6}(?:打算|计划|规划)|离职原因|换工作|薪资期望|期望薪资|为什么选择|为什么离职|为什么应聘|团队冲突|压力|失败经历|成就感?|学习能力|加班|工作强度)/u;

const CHINESE_INTERROGATIVE = /(?:为什么|为何|怎么(?:样|办|做|理解|实现|解决|处理|保证|避免|优化|排查|定位)?|如何|什么|哪些|哪种|哪个|哪一个|多少|是否|能否|可否|有没有|有何|谁|哪里|哪儿|何时|什么时候|你觉得|你认为|你怎么看|你会怎么|你是怎么)/u;

const CHINESE_REQUEST = /(?:请)?(?:介绍一下|介绍下|说一下|说说|讲一下|讲讲|谈一下|谈谈|描述一下|解释一下|分析一下|比较一下|举个例子|举例说明|展开讲|详细讲|复盘一下|总结一下|设计一个|实现一个|写一下|写一个|手写|聊聊|分享一下|回答一下)/u;

const CHINESE_POLITE_REQUEST = /(?:请|麻烦你|你来)(?:从.{0,12})?(?:介绍|说明|解释|分析|比较|描述|设计|实现|写|讲|谈|回答)|(?:我)?想(?:听听|了解|知道|看看).{1,60}/u;

const CHINESE_REQUEST_SUFFIX = /(?:区别|差异|联系|原理|机制|作用|用途|优缺点|复杂度|流程|步骤|使用场景|应用场景|定义|特点|特性|底层实现|实现方式|解决方案)[。.!！\s]*$/u;

const CHINESE_QUESTION_END = /(?:吗|么|呢|嘛|怎么样|如何)[。.!！\s]*$/u;

const CHINESE_ALTERNATIVE_QUESTION = /(?:是|用|选|采用).{1,60}还是/u;

const CHINESE_COLLOQUIAL_QUESTION = /(?:多(?:大|高|久|长|快|慢|重|深)|几(?:个|年|次|人|种|层|台|条|位)?|哪(?:一)?(?:块|部分|方面|端|层)|有没有|(?:做|用|写|接触|遇到)过没有|(?:清楚|熟悉|了解|知道|明白|会|懂)不(?:清楚|熟悉|了解|知道|明白|会|懂))/u;

const ENGLISH_QUESTION_START = /^(?:(?:so|then|and|okay|ok|right)[,\s]+)*(?:what|why|how|when|where|who|which|whose|can|could|would|will|should|do|does|did|is|are|was|were|have|has|had)\b/iu;

const ENGLISH_REQUEST_START = /^(?:(?:so|then|and|okay|ok|right)[,\s]+)*(?:please\s+)?(?:tell me|walk me through|describe|explain|compare|discuss|outline|summarize|design|implement|write|code|give me an example|share an example)\b/iu;

const ENGLISH_PERSONAL_TOPIC = /^(?:your\s+)?(?:strengths?(?:\s+and\s+weaknesses?)?|weaknesses?|career goals?|career plan|salary expectations?|most (?:difficult|challenging) (?:project|experience)|reason for leaving|leadership experience|conflict resolution)\b/iu;

const MULTILINGUAL_PROMPT = /^(?:なぜ|どう|何|どの|説明して|教えて|왜|어떻게|무엇|어떤|설명해|pourquoi|comment|qu['’]est-ce|warum|wie|was|por qué|porque|cómo|qué|почему|как|что|perché|come|cosa)\b/iu;

const INCOMPLETE_CHINESE_END = /(?:你|您|这个|那个|关于|对于|基于|如果|假如|比如|因为|然后|接下来|我想问|我想了解|那你能|你能|请你|说到|谈到|也就是|还有|以及|或者|和|或|跟|把|将|从|在|对|的|了|就|一个|一种)[，,:：、\s]*$/u;

const INCOMPLETE_ENGLISH_END = /(?:\b(?:can|could|would|will|should|do|does|did|is|are|was|were|have|has|had|about|because|if|when|and|or|with|for|to|the|a|an)|\b(?:what is|how do|can you|could you|would you|tell me about|walk me through|please explain|please describe))[,\s]*$/iu;

const INVITES_CANDIDATE_QUESTION = /(?:有什么.{0,8}(?:想问|要问|需要问)|有没有.{0,8}(?:问题|想了解)|questions?\s+for\s+(?:me|us)|anything\s+you(?:'d|\s+would)?\s+like\s+to\s+ask)/iu;

const CLOSING_STATEMENT = /(?:(?:今天|这次|本次).{0,10}(?:到这里|结束)|基本上.{0,8}(?:问完|聊完)|谢谢.{0,10}(?:时间|参与|配合)|辛苦了|再见|goodbye|bye|that(?:'s| is)\s+all|we(?:'re| are)\s+done)/iu;

const INTERVIEW_LOGISTICS = /(?:你?(?:能)?(?:听见|听到|听清|听得清)(?:我(?:说话|的声音)?|声音|这边)?(?:吗|么|没|没有)?|(?:声音|网络|画面).{0,8}(?:清楚|卡|延迟|有点小|有问题)|你在吗|准备好(?:了)?吗|可以开始(?:了)?吗|(?:看得|看不|看)?到(?:我(?:共享的)?屏幕|我的?屏幕|屏幕|共享|画面)(?:吗|么)?|(?:打开|关闭)(?:一下)?(?:摄像头|麦克风)|(?:共享|分享)(?:一下)?屏幕|稍等(?:一下|一会儿)?|等我(?:一下|一会儿)?|(?:can|could)\s+you\s+(?:hear\s+me|see\s+(?:me|my screen)|repeat\s+(?:that|your answer)|speak\s+(?:up|louder))|are\s+you\s+(?:there|ready)|is\s+(?:my\s+)?(?:voice|audio|screen)\s+clear|(?:one\s+moment|hold\s+on|let(?:'s| us)\s+(?:begin|start)))/iu;

const NO_QUESTION_REMAINS = /(?:没|没有)(?:再)?什么(?:问题|疑问|要问的|想问的|特别的|其他的?)/u;

const SELF_ANSWERED_EXPLANATION = /(?:为什么|为何|怎么|如何|what|why|how)[^?？]{0,80}[，,。.!；;]\s*(?:其实|主要|原因(?:是|在于)|是因为|因为|所以|因此|也就是说|the reason|because|so|therefore)/iu;

const CONFIRMATION_TAG = /(?:对吧|是吧|没错吧|可以吧|好吧|right|correct|isn['’]t it|aren['’]t they)[?？。.!！\s]*$/iu;

const LEADING_ACKNOWLEDGEMENT = /^(?:嗯+|呃|额|哦|噢|啊|好(?:的)?|对|是的|没错|ok(?:ay)?|right|sure)[,，。.!！\s]+/iu;

const NOISE_TOKEN = /(?:thank\s*you|got\s*it|okay|right|sure|thanks|hello|yeah|yep|well|hmm|hm|uh|um|oh|ok|yes|no|bye|嗯嗯|知道了|明白了|没错|不是|好的|对的|是的|谢谢|你好|再见|然后|就是|这个|那个|嗯|呃|额|哦|噢|啊|唉|诶|哎|好|行|可以|对|是|你|我|他|她|这|那|吧)/giu;

export function normalizeInterviewUtterance(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactFingerprint(value: string): string {
  return normalizeInterviewUtterance(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function isOnlyConversationNoise(value: string): boolean {
  const fingerprint = compactFingerprint(value);
  if (!fingerprint || EXACT_NON_QUESTIONS.has(fingerprint)) return true;
  return fingerprint.replace(NOISE_TOKEN, '') === '';
}

function looksIncomplete(value: string): boolean {
  const withoutTerminalQuestion = value.replace(/[?？¿؟]\s*$/u, '').trim();
  if (withoutTerminalQuestion !== value.trim()) return false;
  if (/[，,:：、]\s*$/u.test(value)) return true;
  return INCOMPLETE_CHINESE_END.test(value) || INCOMPLETE_ENGLISH_END.test(value);
}

function looksLikeBareInterviewTopic(value: string): boolean {
  const compact = compactFingerprint(value);
  if (compact.length < 2 || compact.length > 40) return false;
  // Bare topics are useful interview shorthand; explanatory statements are
  // not. This avoids turning “线程池可以复用线程” into another model request.
  const declarative = /(?:指的是|意味着|用于|可以|能够|会导致|包括|包含|采用了|使用了|实现了|已经|目前|其实|主要|通常|一般|复用|减少|提高|降低|保证|避免|负责|处理|存储|执行|调用|返回|提供|完成|我(?:们)?(?:这边)?|公司(?:这边)?).{0,12}(?:是|会|有|用|负责|采用|支持|包含|包括)?|\b(?:is|are|uses?|supports?|includes?|means?|provides?|has|have|can)\b/iu;
  return !declarative.test(value);
}

/**
 * Local, deterministic interview gate. It intentionally answers explicit
 * questions, interview instructions and recognizable technical topic prompts,
 * while suppressing acknowledgements, closings, ASR debris and interviewer
 * statements. Ambiguous unfinished prompts receive one bounded settling window.
 */
export function classifyInterviewQuestion(
  value: string,
  options: InterviewQuestionGateOptions = {},
): InterviewQuestionGateResult {
  const normalized = normalizeInterviewUtterance(value);
  if (!normalized) return { decision: 'ignore', reason: 'empty', normalized };
  if (isOnlyConversationNoise(normalized)) {
    return { decision: 'ignore', reason: 'conversation-noise', normalized };
  }

  const invitesCandidateQuestion = INVITES_CANDIDATE_QUESTION.test(normalized);
  if (INTERVIEW_LOGISTICS.test(normalized)) {
    return { decision: 'ignore', reason: 'interview-logistics', normalized };
  }
  if (CLOSING_STATEMENT.test(normalized) && !invitesCandidateQuestion) {
    return { decision: 'ignore', reason: 'interview-closing', normalized };
  }
  if (NO_QUESTION_REMAINS.test(normalized) && !invitesCandidateQuestion) {
    return { decision: 'ignore', reason: 'no-question-remains', normalized };
  }

  const body = normalized.replace(LEADING_ACKNOWLEDGEMENT, '').trim();
  if (!body || isOnlyConversationNoise(body)) {
    return { decision: 'ignore', reason: 'acknowledgement', normalized };
  }

  const hasQuestionMark = /[?？¿؟]/u.test(body);
  const chineseInterrogative = CHINESE_INTERROGATIVE.test(body);
  const chineseRequest = CHINESE_REQUEST.test(body);
  const chinesePoliteRequest = CHINESE_POLITE_REQUEST.test(body);
  const chineseQuestionEnding = CHINESE_QUESTION_END.test(body);
  const chineseAlternative = CHINESE_ALTERNATIVE_QUESTION.test(body);
  const chineseColloquialQuestion = CHINESE_COLLOQUIAL_QUESTION.test(body);
  const englishPrompt = ENGLISH_QUESTION_START.test(body) || ENGLISH_REQUEST_START.test(body);
  const englishPersonalTopic = ENGLISH_PERSONAL_TOPIC.test(body);
  const multilingualPrompt = MULTILINGUAL_PROMPT.test(body);
  const topicRequest = CHINESE_REQUEST_SUFFIX.test(body);
  const substantiveIntent = hasQuestionMark || chineseInterrogative || chineseRequest || chinesePoliteRequest || englishPrompt
    || multilingualPrompt || topicRequest || chineseQuestionEnding || chineseAlternative || chineseColloquialQuestion
    || englishPersonalTopic
    || invitesCandidateQuestion;

  if (!hasQuestionMark && SELF_ANSWERED_EXPLANATION.test(body)) {
    return { decision: 'ignore', reason: 'interviewer-self-explanation', normalized };
  }

  // “……对吧” is normally interviewer narration seeking acknowledgement, not
  // a request for a generated interview answer. A real interrogative earlier in
  // the sentence still wins.
  if (CONFIRMATION_TAG.test(body) && !chineseInterrogative && !chineseRequest && !englishPrompt) {
    return { decision: 'ignore', reason: 'confirmation-tag', normalized };
  }

  if (looksIncomplete(body) && !hasQuestionMark && !chineseRequest) {
    return {
      decision: options.settled ? 'ignore' : 'defer',
      reason: options.settled ? 'unfinished-after-settle' : 'unfinished-prompt',
      normalized,
    };
  }

  if (substantiveIntent) {
    return { decision: 'answer', reason: 'explicit-interview-prompt', normalized };
  }

  // Interviewers also use bare technical nouns as shorthand prompts, e.g.
  // “volatile” or “线程池”. Do not treat an acknowledgement followed by a noun
  // (“对，FCN 信号”) as a new prompt unless it contains explicit intent.
  const hadAcknowledgementPrefix = body !== normalized;
  if (!hadAcknowledgementPrefix
    && (TECHNICAL_TOPIC.test(body) || PERSONAL_INTERVIEW_TOPIC.test(body))
    && looksLikeBareInterviewTopic(body)) {
    const compact = compactFingerprint(body);
    if (compact.length >= 2 && compact.length <= 40) {
      return { decision: 'answer', reason: 'technical-topic-prompt', normalized };
    }
  }

  return { decision: 'ignore', reason: 'statement-without-question-intent', normalized };
}
