import type { AnswerType } from './AnswerPlanner';

const normalizeQuestion = (question: string): string => question.replace(/\s+/g, ' ').trim();

const TECH_OR_CLASS_MEETING_RE = /(什么是|什么叫|区别|有哪些|如何|怎么|为什么|讲一下|说一下|介绍一下|解释一下|避免|恢复|产生|原理|机制|场景|优缺点|对比).{0,100}(锁|并发|线程|进程|死锁|分布式|内存|虚拟内存|用户态|内核态|中断|调度|IO|I\/O|select|poll|epoll|Reactor|网络|缓存|事务|索引|班会|请假|奖学金|考研|就业|实习|宿舍|压力|课程|转专业)|(?:班会|请假|奖学金|考研|就业|实习|宿舍|压力|课程|转专业|锁|并发|线程|进程|死锁|分布式锁|虚拟内存|用户态|内核态|select|poll|epoll)/i;

export const isTechnicalInterviewQuestion = (question?: string | null): boolean => {
  if (!question) return false;
  return TECH_OR_CLASS_MEETING_RE.test(normalizeQuestion(question));
};

export const shouldUseTechnicalInterviewFallback = (question: string | null | undefined, answerType: AnswerType): boolean => {
  if (!isTechnicalInterviewQuestion(question)) return false;
  return answerType === 'technical_concept_answer'
    || answerType === 'system_design_answer'
    || answerType === 'debugging_question_answer'
    || answerType === 'general_meeting_answer'
    || answerType === 'lecture_answer'
    || answerType === 'unknown_answer'
    || answerType === 'follow_up_answer';
};

export const buildTechnicalInterviewFallbackAnswer = (question?: string | null): string | null => {
  const q = normalizeQuestion(question || '');
  if (!q) return null;

  if (/课程|跟不上|学习/.test(q)) {
    return [
      '先把“跟不上”拆清楚：是听课听不懂、作业不会做、复习没时间，还是不知道考试重点。问题拆开以后才好处理。',
      '建议按三步来：课前先看目录和关键词，课堂先抓主线和例题，课后当天补笔记、补作业。连续两周仍然吃力，就及时找任课老师、助教或学习委员确认补基础的方法。',
    ].join('\n');
  }

  if (/考研|就业|实习|找工作/.test(q)) {
    return [
      '考研和就业没有统一答案，关键看目标。考研更适合目标岗位学历门槛高、想继续深造或研究方向明确的同学；就业更适合已经有岗位方向、愿意尽早积累行业经验的同学。',
      '可以用三个问题判断：为什么考或为什么就业、具体目标是什么、如果第一选择失败有什么备选方案。如果这三个问题还模糊，就先做信息收集、项目或实习体验，再做决定。',
    ].join('\n');
  }

  if (/请假/.test(q)) {
    return [
      '请假要提前申请，说明时间、原因、去向和联系方式。病假通常需要证明，事假要写清必要性；离校或跨市要按学院规定审批。',
      '不要事后补假，也不要只让同学口头代传。请假期间课程、作业和班级通知仍然要自己跟进，返校后及时销假。',
    ].join('\n');
  }

  if (/宿舍|寝室/.test(q)) {
    return [
      '宿舍矛盾先具体化，看是作息、卫生、噪音、公共物品还是沟通方式。不要在情绪最激动时扩大冲突，也不要长期忍着不说。',
      '可以先宿舍内部约定清楚规则，比如熄灯后音量、值日安排和公共区域使用。如果沟通无效，再找班委、辅导员或宿管介入，目标是解决规则问题。',
    ].join('\n');
  }

  if (/分布式锁|分布式.{0,12}死锁|死锁.{0,12}分布式/.test(q)) {
    return [
      '分布式锁本质上是让不同机器上的多个任务竞争同一份共享资源时，也能做到互斥访问。分布式死锁则是不同节点上的任务各自持有一部分锁，同时等待对方释放，最后形成循环等待。',
      '避免方式可以从几方面说：统一加锁顺序，破坏循环等待；给锁设置超时和租约，避免节点异常后锁长期不释放；缩短事务和持锁时间，减少跨节点竞争；必要时使用等待图检测、超时回滚和幂等重试来恢复。',
    ].join('\n');
  }

  if (/线程.{0,20}进程|进程.{0,20}线程|线程和进程|进程和线程/.test(q)) {
    return [
      '进程是资源分配的基本单位，线程是 CPU 调度执行的基本单位。',
      '进程有独立地址空间，隔离性强但切换开销大；同一进程内的线程共享地址空间和资源，通信方便、切换轻量，但更容易出现竞态条件。总结起来，进程强调隔离和稳定，线程强调轻量并发和执行效率。',
    ].join('\n');
  }

  if (/虚拟内存/.test(q)) {
    return [
      '虚拟内存是操作系统给每个进程提供的一层抽象地址空间，让进程看起来拥有连续、独立的内存。',
      '它主要解决进程隔离、灵活内存管理和地址空间扩展三个问题：通过页表把虚拟地址映射到物理地址，通过换页把暂时不用的页面放到磁盘。代价是地址转换和缺页中断有开销，所以系统会用 TLB、页面置换算法和局部性原理优化。',
    ].join('\n');
  }

  if (/用户态|内核态/.test(q)) {
    return [
      '用户态和内核态是 CPU 的两种权限级别。用户态运行普通应用程序，权限受限；内核态运行操作系统内核，可以访问硬件和全部内存资源。',
      '这样设计是为了安全和稳定。应用程序不能直接操作硬件或关键内核数据，需要通过系统调用进入内核态，由操作系统代为完成文件读写、网络通信、进程管理等操作。',
    ].join('\n');
  }

  if (/死锁/.test(q)) {
    return [
      '死锁是多个线程或进程相互等待对方持有的资源，导致谁都无法继续执行。',
      '经典四个必要条件是互斥、占有且等待、不可抢占、循环等待。避免死锁通常就是破坏其中一个条件，例如统一加锁顺序、申请不到锁就释放已持有资源、给锁加超时，或者减少持锁时间。',
    ].join('\n');
  }

  if (/锁|并发/.test(q)) {
    return [
      '锁主要是为了解决并发访问共享资源时的数据一致性问题。',
      '可以按层次回答：操作系统有互斥锁、读写锁、自旋锁、信号量；Java 有 synchronized、ReentrantLock、读写锁和 CAS 相关的乐观锁；数据库有行锁、表锁、间隙锁；分布式场景还有 Redis、ZooKeeper 或数据库实现的分布式锁。',
      '选择时看冲突频率、临界区长度和一致性要求。冲突低可以用乐观锁，临界区短可考虑自旋，读多写少适合读写锁，跨进程或跨服务才需要分布式锁。',
    ].join('\n');
  }

  if (/select|poll|epoll|IO|I\/O|网络事件|Reactor/i.test(q)) {
    return [
      'I/O 多路复用的核心是让一个线程同时监听多个连接，哪个连接就绪了再处理哪个连接，避免一个连接阻塞整个线程。',
      'select 和 poll 每次都需要把文件描述符集合交给内核，返回后还要遍历查找就绪连接；epoll 把关注的 fd 维护在内核里，通过事件回调把就绪 fd 放到队列，更适合高并发网络服务。Reactor 模型就是基于事件驱动，把 I/O 事件分发给对应 handler 或线程池。',
    ].join('\n');
  }

  return [
    `${q} 可以先抓住“定义、原因、做法、注意事项”四个点来回答。`,
    '如果是学生班会问题，先给明确规则或建议，再说明为什么这样做，最后告诉同学下一步找谁、准备什么材料。回答要具体、可执行，不要只说原则。',
  ].join('\n');
};
