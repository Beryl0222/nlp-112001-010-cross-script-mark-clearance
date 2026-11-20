// 音译所需的无调读音表。资料之外的字可以继续补入；遇到未收字时，
// 调用方会得到 unknown，并据此放弃不可靠的跨文字命中。
const charReadings = {
  雨: 'yu', 杉: 'shan', 山: 'shan', 青: 'qing', 锋: 'feng',
  做: 'zuo', 滴: 'di', 灌: 'guan', 配: 'pei', 件: 'jian',
  套: 'tao', 管: 'guan', 代: 'dai', 工: 'gong', 不: 'bu',
  打: 'da', 这: 'zhe', 个: 'ge', 标: 'biao', 志: 'zhi',
  也: 'ye', 考: 'kao', 虑: 'lü', 英: 'ying', 文: 'wen',
  供: 'gong', 带: 'dai', 商: 'shang', 业: 'ye',
  河: 'he', 岸: 'an', 园: 'yuan', 艺: 'yi',
  松: 'song', 岛: 'dao', 海: 'hai', 港: 'gang', 区: 'qu',
  本: 'ben', 公: 'gong', 司: 'si', 简: 'jian', 称: 'cheng',
  现: 'xian', 用: 'yong', 是: 'shi', 参: 'can', 同: 'tong',
  行: 'xing', 的: 'de', 但: 'dan', 申: 'shen', 请: 'qing',
  它: 'ta', 设: 'she', 计: 'ji', 软: 'ruan',
  品: 'pin', 类: 'lei', 说: 'shuo', 明: 'ming',
  注: 'zhu', 册: 'ce', 字: 'zi', 样: 'yang',
  器: 'qi', 具: 'ju', 接: 'jie', 头: 'tou', 及: 'ji', 阀: 'fa',
  仅: 'jin', 流: 'liu', 体: 'ti', 传: 'chuan', 输: 'shu',
  包: 'bao', 括: 'kuo', 木: 'mu', 纹: 'wen',
  服: 'fu', 务: 'wu', 景: 'jing', 观: 'guan', 规: 'gui', 划: 'hua',
  塑: 'su', 料: 'liao', 零: 'ling', 部: 'bu',
  有: 'you', 限: 'xian', 科: 'ke', 技: 'ji', 贸: 'mao', 易: 'yi',
  农: 'nong', 五: 'wu', 金: 'jin', 电: 'dian', 子: 'zi',
  食: 'shi', 装: 'zhuang', 化: 'hua', 妆: 'zhuang', 械: 'xie',
  医: 'yi', 药: 'yao', 教: 'jiao', 育: 'yu', 餐: 'can', 饮: 'yin',
  酒: 'jiu', 店: 'dian', 旅: 'lü', 游: 'you', 房: 'fang',
  地: 'di', 产: 'chan', 建: 'jian', 筑: 'zhu', 家: 'jia',
  灯: 'deng', 玩: 'wan', 媒: 'mei', 广: 'guang', 告: 'gao',
  咨: 'zi', 询: 'xun', 网: 'wang', 络: 'luo', 硬: 'ying',
  通: 'tong', 信: 'xin', 汽: 'qi', 车: 'che', 能: 'neng',
  源: 'yuan', 环: 'huan', 保: 'bao', 纺: 'fang', 织: 'zhi',
  饰: 'shi', 鞋: 'xie', 帽: 'mao', 箱: 'xiang', 珠: 'zhu',
  宝: 'bao', 钟: 'zhong', 表: 'biao', 眼: 'yan', 镜: 'jing',
  茶: 'cha', 咖: 'ka', 啡: 'fei', 糖: 'tang', 果: 'guo',
  蔬: 'shu', 粮: 'liang', 油: 'you', 肉: 'rou', 奶: 'nai',
  机: 'ji', 光: 'guang', 新: 'xin', 星: 'xing', 云: 'yun',
  天: 'tian', 龙: 'long', 凤: 'feng', 鑫: 'xin', 盛: 'sheng',
  达: 'da', 泰: 'tai', 和: 'he', 美: 'mei', 丽: 'li', 华: 'hua',
  中: 'zhong', 国: 'guo', 亚: 'ya', 欧: 'ou', 北: 'bei',
  京: 'jing', 上: 'shang', 深: 'shen', 圳: 'zhen', 杭: 'hang',
  州: 'zhou', 苏: 'su', 宁: 'ning', 波: 'bo', 厦: 'xia',
  门: 'men', 台: 'tai', 湾: 'wan', 香: 'xiang', 澳: 'ao',
  长: 'chang', 重: 'zhong', 乐: 'le', 藏: 'cang', 朝: 'chao',
  西: 'xi', 安: 'an', 福: 'fu', 湖: 'hu', 南: 'nan',
  东: 'dong', 陕: 'shan', 甘: 'gan', 肃: 'su', 疆: 'jiang',
  内: 'nei', 蒙: 'meng', 古: 'gu', 辽: 'liao', 吉: 'ji', 林: 'lin',
  黑: 'hei', 江: 'jiang', 贵: 'gui', 四: 'si', 川: 'chuan'
};

// 多音字在词组中的读法优先于单字默认读法。
const phraseReadings = {
  同行: 'tonghang',
  银行: 'yinhang',
  行业: 'hangye',
  行长: 'hangzhang',
  重量: 'zhongliang',
  重复: 'chongfu',
  重庆: 'chongqing',
  长大: 'zhangda',
  长江: 'changjiang',
  长城: 'changcheng',
  音乐: 'yinyue',
  快乐: 'kuaile',
  厦门: 'xiamen',
  西藏: 'xizang',
  朝阳: 'chaoyang',
  蒙古: 'menggu'
};

const phraseLengths = [...new Set(Object.keys(phraseReadings).map(word => word.length))]
  .sort((a, b) => b - a);

/** 汉字转无调拼音；未收录的字记入 unknown，不猜测读音。 */
export function romanizeHan(text) {
  let output = '';
  const unknown = [];
  for (let index = 0; index < text.length;) {
    let usedPhrase = false;
    for (const length of phraseLengths) {
      const phrase = text.slice(index, index + length);
      if (phrase.length === length && phraseReadings[phrase]) {
        output += phraseReadings[phrase];
        index += length;
        usedPhrase = true;
        break;
      }
    }
    if (usedPhrase) continue;

    const char = text[index];
    if (/\p{Script=Han}/u.test(char)) {
      const reading = charReadings[char];
      if (reading === undefined) unknown.push(char);
      else output += reading;
    } else if (/[A-Za-z0-9]/.test(char)) {
      output += char.toLowerCase();
    }
    index += 1;
  }
  return { text: output, unknown: [...new Set(unknown)] };
}
