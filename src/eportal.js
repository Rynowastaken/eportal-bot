export const EPORTAL_ORIGIN = "https://eportal.nutc.edu.tw";
export const EPORTAL_HOME = `${EPORTAL_ORIGIN}/`;
export const EPORTAL_DASHBOARD = `${EPORTAL_ORIGIN}/nutc_dashboard/`;

export const MODULES = Object.freeze([
  {
    id: "ais",
    name: "學生管理系統",
    shortName: "學生管理",
    description: "課表、學籍與學生資訊",
    uuid: "8a782d88-721c-4545-a5b7-c6a986158c64",
    path: "/?app_id=NUTC_6401",
    sourceColor: "#a742ae",
    icon: "graduation-cap",
    serverBacked: true,
  },
  {
    id: "webmail",
    name: "WebMail郵件系統",
    shortName: "WebMail",
    description: "校務信箱與通知",
    uuid: "26645edb-4114-4322-a3f1-96d569928b6d",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_lPGpV8f9YqQ8qgA9cyn8QA",
    sourceColor: "#4e7dda",
    icon: "mail",
  },
  {
    id: "activity",
    name: "活動報名暨投票系統",
    shortName: "活動報名",
    description: "活動、報名與投票",
    uuid: "e407696e-de54-429a-8e5a-93bdd3c2586e",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_PI9bsUzimpCHrDSTPoMVcQ",
    sourceColor: "#da5e0b",
    icon: "clipboard-check",
  },
  {
    id: "ep",
    name: "學生學習歷程(EP)跨平台整合系統",
    shortName: "學習歷程",
    description: "EP 學習歷程與成果",
    uuid: "21b57b37-4685-490d-b127-05f5eefe6735",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_pmabVqSXTYna294Vl9JLJg",
    sourceColor: "#d75656",
    icon: "route",
  },
  {
    id: "tronclass",
    name: "TronClass創新教學平台",
    shortName: "TronClass",
    description: "課程、教材、作業與測驗",
    uuid: "d54250aa-edce-4fa2-8cdc-9d708537cccb",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_OBbFAusuXIjtGB-G8RS4gQ",
    sourceColor: "#a742ae",
    icon: "book-open-check",
  },
]);

export function moduleById(moduleId) {
  const module = MODULES.find((entry) => entry.id === moduleId);
  if (!module) throw new Error("Unknown ePortal module.");
  return module;
}

export function moduleUrl(moduleId) {
  return new URL(moduleById(moduleId).path, EPORTAL_ORIGIN).toString();
}

export function publicModules() {
  return MODULES.map(({ path, ...module }) => ({
    ...module,
    launchPath: module.id === "ais" ? "/student.html" : `/go/${module.id}`,
  }));
}
