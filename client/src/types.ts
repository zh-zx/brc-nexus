export interface GermplasmItem {
  id: string;
  cipNo?: string;
  cccapNo: string;
  name?: string;
  lastSubcultureDate?: string;
  [key: string]: any;
}

export interface Operator {
  id: string;
  name: string;
}

export interface MediaType {
  id: string;
  name: string;
}

export enum LabelElementType {
  TEXT_STATIC = 'TEXT_STATIC',
  TEXT_DYNAMIC = 'TEXT_DYNAMIC',
  TEXT_PARAGRAPH = 'TEXT_PARAGRAPH',
  QR_CODE = 'QR_CODE',
  BARCODE = 'BARCODE',
  TABLE = 'TABLE',
  RECTANGLE = 'RECTANGLE',
  CIRCLE = 'CIRCLE',
  LINE = 'LINE',
  IMAGE = 'IMAGE',
  ICON = 'ICON',
  DATE = 'DATE',
}

/** 内容片段：一条文本/条码/二维码的内容由多个片段拼接而成 */
export type SegmentType = 'text' | 'field' | 'variable' | 'date' | 'serial';

export interface LabelSegment {
  id: string;
  type: SegmentType;
  text?: string;          // 固定文本内容
  field?: string;         // 数据源字段（Excel 列名）
  variable?: string;      // 全局变量名
  dateFormat?: string;    // 日期格式，如 YYYY年MM月DD日 / YYMMDD
  dateOffset?: number;    // 偏移天数（正=未来，负=过去）
  serialStart?: number;   // 序列号起始值
  serialStep?: number;    // 序列号步长
  serialRepeat?: number;  // 每个号码重复次数
  serialDecrement?: boolean; // 递减
  serialPad?: number;     // 最小位数占位（如 3 → 001）
}

/** 表格单元格 */
export interface TableCell {
  text: string;
  rowSpan?: number;
  colSpan?: number;
  bgColor?: string;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  hidden?: boolean;  // 被合并单元格覆盖的空位
}

export interface LabelElement {
  id: string;
  type: LabelElementType;
  field?: string;
  content?: string;
  segments?: LabelSegment[];   // 数据绑定片段（LabelNova 风格）
  assignVariable?: string;     // 将本元素解析结果赋值给全局变量（高阶用法）
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  isBold?: boolean;
  fontFamily?: string;
  rotation?: number;           // 旋转角度（度）
  flipH?: boolean;             // 水平翻转
  flipV?: boolean;             // 垂直翻转
  color?: string;              // 文字/填充色
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  cornerRadius?: number;       // 矩形圆角
  dashed?: boolean;            // 虚线
  dashLength?: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  isInverted?: boolean;        // 反色（黑底白字等）
  // 条码 / 二维码
  barcodeType?: string;        // CODE128 / EAN13 / ...（1D）；QRCODE/DataMatrix/PDF417/Aztec（2D）
  barcodeTextDisplay?: 'bottom' | 'top' | 'none';
  barcodeWidthRatio?: number;  // 条宽比
  eccLevel?: string;           // 纠错级别 L/M/Q/H
  // 表格
  table?: {
    rows: number;
    cols: number;
    cells: TableCell[];
    rowHeights?: number[];
    colWidths?: number[];
  };
  // 图片 / 图标
  imageSrc?: string;           // data URL
  iconName?: string;           // lucide 图标名
  // 编组
  groupId?: string;
}

export interface LabelPageLayout {
  mode: 'roll' | 'sheet';
  sheetWidth?: number;
  sheetHeight?: number;
  rows?: number;
  cols?: number;
  marginTop?: number;
  marginLeft?: number;
  marginBottom?: number;
  marginRight?: number;
  gapX?: number;
  gapY?: number;
  /** 卷式多列 */
  rollCols?: number;
  rollGapX?: number;
}

export interface LabelTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: LabelElement[];
  layout?: LabelPageLayout;
  /** 自定义全局变量（名称 -> 默认值），打印时供片段引用 */
  variables?: Record<string, string>;
  backgroundColor?: string;
  backgroundImage?: string; // data URL
  lastModified?: string;
}

export interface RoomItem {
  id: string;
  germplasmName: string;
  quantity: number;
  form: 'Glass Tube' | 'Plastic Jar' | 'Box' | 'Other';
  updatedAt: string;
}

export interface Room {
  id: string;
  name: string;
  items: RoomItem[];
}

export type Language = 'zh' | 'en';

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  display_name?: string;
  user_type?: string;
  org?: string;
  status?: string;
  avatar?: string;
}

export interface DashboardStats {
  totalAccessions: number;
  totalInventory: number;
  totalRooms: number;
  potatoCount: number;
  sweetPotatoCount: number;
  unknownSpecies: number;
  recentEvents: any[];
}
