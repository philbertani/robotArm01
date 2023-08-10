import GPU from "./GPU"

class App {

  constructor() {
    console.log("apparently the document is loaded");
    const canvas = document.getElementById("canvas");
    
    const canvas2 = document.getElementById("canvas2");
    //canvas2.insertAdjacentHTML("afterbegin",'<p style="color:blue; text-align:center">RoboCam View</p>');

    this.gpu = new GPU(canvas,canvas2);
  }

}

export default App
