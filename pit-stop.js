(() => {
  'use strict';

  const section = document.getElementById('pit-stop');
  if (!section) return;

  const replies = {
    traffic: {
      comfort: [
        '一路走走停停，耐心被一点点磨薄。现在停稳了，先坐一会儿也好。',
        '堵着的时候，连分钟都走得慢。这会儿终于不用跟着车流挪了。',
        '等了一路，烦是真的。剩下这几分钟，可以留给自己。'
      ],
      humor: [
        '导航说还剩五分钟。过了五分钟，它还说剩五分钟。它比谁都乐观。',
        '晚高峰像一场大型耐心测试，前进两米居然有种解锁新地图的感觉。',
        '整条路走一米停三秒，像全城约好一起练慢动作。还好你这一场收工了。'
      ]
    },
    honk: {
      comfort: [
        '你正专心看路，突然听到一声喇叭，心里紧一下很自然。现在可以慢下来。',
        '那一声来得又急又响，被吓到、被催到，确实会不舒服。停稳后先歇一会儿。',
        '刚才的声音过去了，心里的动静可能还在。给自己留一点安静就好。'
      ],
      humor: [
        '刚才那声喇叭戏份挺足，自带一个感叹号。现在这幕拍完，轮到安静上场。',
        '刚才路上的音效师有点热情，车一停就加音效。到站，片尾静音。',
        '这一路的喇叭像群聊提示音，叮叮当当没完。现在你可以下线了。'
      ]
    },
    cutin: {
      comfort: [
        '好好留着的车距，突然就被占了，心里憋一下很自然。刚才那段已经过去了。',
        '突然有车挤进来，你还得重新判断车距，确实烦。现在终于可以歇一会儿。',
        '那一下来得突然，注意力一下全绷紧了。车已经停稳，这几分钟留给你自己。'
      ],
      humor: [
        '刚才的通勤突然插播了一段换位表演。好在已经散场，不用等返场。',
        '眼前留的明明是车距，刚才有辆车硬看成了入场券。现在演出结束了。',
        '这条路的剧情转得挺急，突然多了一位抢镜的配角。车停了，主角下班。'
      ]
    },
    longday: {
      comfort: [
        '忙了一天还得集中精神开车，这段路走下来真不轻松。先坐一会儿，等你想走再走。',
        '开到这儿已经耗了不少力气。车停稳了，这一小会儿可以留给自己。',
        '有些事可以晚一点再想。你今天已经做了很多，先歇一会儿也好。'
      ],
      humor: [
        '白天已经跑够了任务，回家路上还送你一段隐藏关。到站，终于可以退游戏了。',
        '今天的电量图标都快看不见了。车已停好，人也可以切到省电模式。',
        '如果今天还有片尾字幕，第一行该写「司机辛苦了」。然后加一行「明天再说」。'
      ]
    },
    general: {
      comfort: [
        '这一路要是走得不痛快，停车后心里还憋着也正常。先坐一会儿就好。',
        '车可以停下，心里的动静有时还要多等一会儿。你可以慢慢来。',
        '有些路上的事，下车前还会在心里响一阵。给自己留一小会儿。'
      ],
      humor: [
        '今天这趟路附赠了一段通勤花絮，内容有点乱。已经到站，片尾可以跳过了。',
        '这段路有点抢戏。现在灯光一收，主角下班。',
        '导航送你到这儿。至于路上的闹腾插曲，就请它自己坐下一班车吧。'
      ]
    }
  };
  const topicPatterns = [
    ['cutin', /加塞|夹塞|插队|硬挤|挤进来|突然(?:变道|并线)|强行(?:变道|并线)|抢道|别车|不打灯/],
    ['honk', /喇叭|鸣笛|按笛|滴滴响|按我|被滴|催我/],
    ['traffic', /堵车|好堵|很堵|太堵|堵在|堵死|堵得|堵了|堵成|拥堵|高峰|挪不动|动不了|走走停停|排了半天|等了半天|一动不动/],
    ['longday', /上班|加班|下班|通勤|跑单|接单|晚班|夜班|辛苦|累|疲惫|一天|开了好久/]
  ];

  const form = section.querySelector('#pit-form');
  const input = section.querySelector('#pit-input');
  const result = section.querySelector('#pit-result');
  const resultTitle = section.querySelector('#pit-result-title');
  const resultText = section.querySelector('#pit-result-text');
  const copyButton = section.querySelector('#pit-copy');
  const copyStatus = section.querySelector('#pit-copy-status');
  const modeButtons = [...section.querySelectorAll('[data-pit-mode]')];
  const topicButtons = [...section.querySelectorAll('[data-pit-topic]')];
  const nextLine = new Map();
  let mode = 'comfort';
  let topic = '';

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      mode = button.dataset.pitMode;
      for (const option of modeButtons) {
        option.setAttribute('aria-pressed', String(option === button));
      }
    });
  }

  for (const button of topicButtons) {
    button.addEventListener('click', () => {
      topic = topic === button.dataset.pitTopic ? '' : button.dataset.pitTopic;
      for (const option of topicButtons) {
        option.setAttribute('aria-pressed', String(option.dataset.pitTopic === topic));
      }
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const matchedTopic = topic || topicPatterns.find(([, pattern]) => pattern.test(input.value))?.[0] || 'general';
    const key = `${matchedTopic}:${mode}`;
    const options = replies[matchedTopic][mode];
    const index = nextLine.get(key) || 0;
    nextLine.set(key, (index + 1) % options.length);
    copyStatus.textContent = '';
    result.hidden = false;
    resultTitle.textContent = mode === 'comfort' ? '陪你一句' : '轻松一句';
    resultText.textContent = options[index];
  });

  copyButton.addEventListener('click', async () => {
    const line = resultText.textContent;
    if (result.hidden || !line) return;
    try {
      await navigator.clipboard.writeText(line);
      if (resultText.textContent === line) copyStatus.textContent = '已复制这句话。';
    } catch {
      if (resultText.textContent === line) copyStatus.textContent = '可以长按或选中上面这句话，手动复制。';
    }
  });
})();
