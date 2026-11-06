import { useLoad } from "./useLoad.mjs";
export function useRecords(api, kind, version) {
  return useLoad(api, "/api/records?kind=" + kind, version);
}
