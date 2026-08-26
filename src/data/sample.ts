import type { GraphData } from "../types";

const notes = [
  ["home", "Карта знаний", "00. Files/Карта знаний.md", "Files"],
  ["day", "Проведение дня", "20. Areas/20.30 AI Career/20.01 Проведение дня.md", "Areas"],
  ["morning", "Утро", "20. Areas/20.10 Привычки/01 Утро.md", "Areas"],
  ["blog", "Ведение IT Блога", "10. Projects/10.30 Блог/Ведение IT Блога.md", "Projects"],
  ["tiktok", "ТикТок Идеи", "10. Projects/10.30 Блог/ТикТок Идеи.md", "Projects"],
  ["polls", "Anonym Polls Web Application", "10. Projects/10.20 IT Проекты/Anonym Polls Web Application.md", "Projects"],
  ["database", "Подключение базы данных", "10. Projects/10.20 IT Проекты/Подключение базы данных.md", "Projects"],
  ["indigo", "Indigo Education", "10. Projects/10.20 IT Проекты/Indigo Education.md", "Projects"],
  ["business", "Бизнес-план", "10. Projects/10.20 IT Проекты/Бизнес-план.md", "Projects"],
  ["media", "Indigo Media", "10. Projects/10.40 Indigo Media/Indigo Media.md", "Projects"],
  ["sales", "Продажи", "10. Projects/10.40 Indigo Media/Продажи.md", "Projects"],
  ["ads", "Реклама", "10. Projects/10.40 Indigo Media/Реклама.md", "Projects"],
  ["aes", "Aes Way - Telegram", "10. Projects/10.50 Aes Way/Aes Way - Telegram.md", "Projects"],
  ["productivity", "Повышение продуктивности", "30. Resources/Аспекты саморазвития/Повышение продуктивности.md", "Resources"],
  ["feynman", "Метод Фейнмана", "30. Resources/Аспекты саморазвития/Метод Фейнмана.md", "Resources"],
  ["learning", "Учиться меньше, но быстрее", "30. Resources/Аспекты саморазвития/Учиться меньше, но быстрее.md", "Resources"],
  ["speed", "Скорочтение", "30. Resources/Аспекты саморазвития/Скорочтение.md", "Resources"],
  ["talent", "Код таланта", "30. Resources/Книги/Код таланта/01 Введение.md", "Resources"],
  ["nvc", "Язык Жизни ННО", "30. Resources/Книги/Язык Жизни ННО/001 ННО.md", "Resources"],
  ["people", "Читать человека как книгу", "30. Resources/Книги/Читать человека как книгу.md", "Resources"],
  ["benefit", "Чистая выгода", "30. Resources/Книги/ЧЧКК - Чистая выгода.md", "Resources"],
  ["logic", "Логик и эмоционал", "30. Resources/Книги/ЧЧКК - Логик и эмоционал.md", "Resources"],
  ["books", "Книги", "40. Archive/Книги/001 Саморазвитие, Бизнес-литература.md", "Archive"],
  ["fiction", "Художественные", "40. Archive/Книги/002 Художественные.md", "Archive"],
] as const;

export const sampleGraph: GraphData = {
  nodes: notes.map(([id, title, path, group]) => ({ id, title, path, group })),
  edges: [
    ["home", "day"], ["home", "blog"], ["home", "polls"], ["home", "productivity"],
    ["day", "morning"], ["day", "productivity"], ["morning", "learning"],
    ["blog", "tiktok"], ["blog", "aes"], ["tiktok", "ads"],
    ["polls", "database"], ["polls", "indigo"], ["indigo", "business"],
    ["indigo", "media"], ["media", "sales"], ["media", "ads"],
    ["productivity", "feynman"], ["productivity", "learning"], ["learning", "speed"],
    ["learning", "talent"], ["learning", "nvc"], ["people", "benefit"],
    ["people", "logic"], ["books", "people"], ["books", "talent"],
    ["books", "fiction"], ["nvc", "logic"], ["feynman", "talent"],
  ].map(([source, target]) => ({ source, target })),
};
