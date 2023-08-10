import GPU from "./GPU"

class App {

  constructor() {
    console.log("apparently the document is loaded");
    this.canvas = document.getElementById("canvas");
    
    this.canvas2 = document.getElementById("canvas2");
    this.canvas2.insertAdjacentHTML("afterbegin",'<p style="color:white; text-align:center">RoboCam View</p>');

    this.gpu = new GPU(this.canvas);
  }

}

export default App
