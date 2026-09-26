import * as api from "./index.js";
import { msagent } from "./load.js";

// <script> で読み込んだときの window.msagent。ESM で import できるもの (RequestError など) も全部載せる。
// コピーではなく msagent そのものに足すのは、msagent.BASE_PATH の書き換えを load() が見るため
const named: Partial<typeof api> = { ...api };
delete named.default;
export default Object.assign(msagent, named);
