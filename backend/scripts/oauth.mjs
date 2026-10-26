import { api } from "./client.mjs";
const { url } = await api("/v1/integrations/google/connect", {});
console.log(
  "Open this short-lived Google consent link in your browser (do not share it):\n" +
    url,
);
