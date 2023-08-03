import App from "./app"

console.log("the document is not necessarily loaded yet...");
document.addEventListener("DOMContentLoaded", (event) => {
  new App();
});
