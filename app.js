import GPU from "./GPU"

class App {

  constructor() {
    console.log("apparently the document is loaded");
    this.canvas = document.getElementById("canvas");
    this.gpu = new GPU(this.canvas);
  }

}

export default App
