import type { ApiComic } from "@/hooks/useComicTypes";
import {
  calculateStoredReadingProgress,
  getReadingPageNumber,
  hasReadingStarted,
  isStoredReadingFinished,
} from "@/lib/progress";

export type PreviewBook = ApiComic & { accent: string; library: string };
export type ContentType = "all" | "comic" | "novel";

const covers = (name: string) => `/shelf-preview/${name}.jpg`;
const now = Date.now();
type Sample = {
  id: string;
  title: string;
  cover?: string;
  page: number;
  total: number;
  accent: string;
  genre: string;
  type: "comic" | "novel";
  author: string;
  description: string;
};

const samples: Sample[] = [
  { id: "ember", title: "余烬之城 21", page: 12, total: 55, accent: "#80a9e5", genre: "热血", type: "comic", author: "林川", description: "赤月升起的夜晚，少年剑士重新踏入故乡。废墟深处，仍有人守着多年前的约定。" },
  { id: "apothecary", title: "药师手札", page: 12, total: 35, accent: "#dfa96c", genre: "悬疑", type: "novel", author: "许知微", description: "一缕异香，一瓶无名药剂。年轻药师在深宫的日常里，渐渐发现了无人提起的秘密。" },
  { id: "wanderer", title: "森林行旅", page: 15, total: 44, accent: "#93b6da", genre: "奇幻", type: "novel", author: "陆遥", description: "漫长的旅途没有终点。魔法师沿着旧地图穿过森林，寻找那些曾经与她同行的人。" },
  { id: "winter", title: "冬境旅人", page: 15, total: 24, accent: "#9da8d4", genre: "冒险", type: "comic", author: "白岚", description: "两个陌生人走过冰封王国，寻找只在初雪时出现的城堡。风雪之外，新的故事正在等待。" },
  { id: "shadow", title: "暗影之门", page: 38, total: 50, accent: "#86c39c", genre: "奇幻", type: "comic", author: "江屿", description: "紫色夜幕笼罩城市。一个并不勇敢的守卫，必须在黎明之前学会与自己的影子共处。" },
  { id: "northwind", title: "北境长风 03", page: 102, total: 102, accent: "#77baa9", genre: "冒险", type: "comic", author: "陈砚", description: "黎明时，船离开北方港口。年轻的探险者第一次走向大海，也第一次真正告别过去。" },
  { id: "afterglow", title: "暮色回响", page: 38, total: 50, accent: "#b98ddd", genre: "热血", type: "comic", author: "周野", description: "工厂与落日之间，一位年轻机械师发现了藏在城市深处的秘密。最后一束光，也许正是新的开始。" },
  { id: "ember-20", title: "余烬之城 20", cover: "ember", page: 55, total: 55, accent: "#80a9e5", genre: "热血", type: "comic", author: "林川", description: "在城市陷落之前，一句安静的承诺改变了两个朋友的人生。这是那个夜晚的故事。" },
  { id: "apothecary-2", title: "药师手札：暗香", cover: "apothecary", page: 33, total: 35, accent: "#dfa96c", genre: "悬疑", type: "novel", author: "许知微", description: "宫中新来的客人带来一个显而易见的谜题。药师沿着药方与传闻，走进了另一场风波。" },
  { id: "winter-1", title: "冬境旅人 01", cover: "winter", page: 0, total: 24, accent: "#9da8d4", genre: "冒险", type: "comic", author: "白岚", description: "一次偶然的相遇，让两个截然不同的旅人一起踏上北方山脉。" },
  { id: "wanderer-7", title: "森林行旅：长夏", cover: "wanderer", page: 0, total: 44, accent: "#93b6da", genre: "奇幻", type: "novel", author: "陆遥", description: "古树之外的村庄遗忘了季节。路过的魔法师停下来，听见了一个漫长夏天的往事。" },
  { id: "northwind-4", title: "北境长风：归航", cover: "northwind", page: 102, total: 102, accent: "#77baa9", genre: "冒险", type: "novel", author: "陈砚", description: "大海暂时安静下来，但船员们知道风暴即将到来。归途的故事，关于忠诚、失去与继续前行。" },
];

export const initialBooks: PreviewBook[] = samples.map((sample, index) => ({
  id: sample.id,
  title: sample.title,
  filename: `${sample.title}.${sample.type === "novel" ? "epub" : "cbz"}`,
  pageCount: sample.total,
  fileSize: (sample.type === "novel" ? 3.8 : 48.6) * 1024 * 1024,
  addedAt: new Date(now - index * 3 * 60 * 60 * 1000).toISOString(),
  lastReadPage: Math.max(0, sample.page - 1),
  lastReadAt: sample.page ? new Date(now - (sample.id === "afterglow" ? 20 : index * 47 + 30) * 60 * 1000).toISOString() : null,
  readingStatus: sample.page >= sample.total ? "finished" : sample.page ? "reading" : "",
  isFavorite: ["afterglow", "wanderer"].includes(sample.id),
  rating: null,
  coverUrl: covers(sample.cover || sample.id),
  coverAspectRatio: 2 / 3,
  sortOrder: index,
  totalReadTime: sample.page * 45,
  tags: [{ name: sample.genre, color: sample.accent }],
  categories: [{ id: sample.type === "comic" ? 1 : 2, name: sample.type === "comic" ? "漫画书库" : "小说书库", slug: sample.type, icon: "book" }],
  author: sample.author,
  publisher: "",
  year: 2026,
  description: sample.description,
  language: "zh-CN",
  genre: sample.genre,
  metadataSource: "preview",
  type: sample.type,
  accent: sample.accent,
  library: sample.type === "comic" ? "漫画书库" : "小说书库",
}));

export const bookProgress = (book: ApiComic) => calculateStoredReadingProgress(book.lastReadPage, book.pageCount, book.lastReadAt, book.readingStatus);
export const bookFinished = (book: ApiComic) => isStoredReadingFinished(book.lastReadPage, book.pageCount, book.lastReadAt, book.readingStatus);
export const bookStarted = (book: ApiComic) => hasReadingStarted(book.lastReadPage, book.lastReadAt, book.readingStatus);
export const bookPage = (book: ApiComic) => bookStarted(book) ? getReadingPageNumber(book.lastReadPage, book.pageCount) : 0;
export const bookUnit = (book: ApiComic) => book.type === "novel" ? "章" : "页";
export const bookCount = (book: ApiComic) => `${bookPage(book)} / ${book.pageCount} ${bookUnit(book)}`;
export const bookFormat = (book: ApiComic) => book.filename.split(".").pop()?.toUpperCase() || "";

// The reader presents 1-based pages; the project's API stores zero-based indices.
export function withReadingPage(book: PreviewBook, page: number): PreviewBook {
  const next = Math.max(0, Math.min(book.pageCount, Math.round(page)));
  return {
    ...book,
    lastReadPage: Math.max(0, next - 1),
    lastReadAt: next ? new Date().toISOString() : null,
    readingStatus: next >= book.pageCount ? "finished" : next ? "reading" : "",
  };
}

export function selectDashboardBooks(books: PreviewBook[], type: ContentType) {
  const visible = books.filter((book) => type === "all" || book.type === type);
  const reading = visible.filter((book) => bookStarted(book) && !bookFinished(book));
  return {
    visible,
    reading: [...reading].sort((a, b) => Date.parse(b.lastReadAt!) - Date.parse(a.lastReadAt!)).slice(0, 8),
    readingCount: reading.length,
    recent: [...visible].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)).slice(0, 6),
    unread: visible.filter((book) => !bookStarted(book)).length,
    finished: visible.filter(bookFinished).length,
  };
}
