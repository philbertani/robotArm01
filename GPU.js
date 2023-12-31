import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader";
import { Reflector } from 'three/examples/jsm/objects/Reflector';

// start of arm model stuff - put into its own module at some point
// tinkercad puts objects in seemingly random order, this maps them 
// from top to bottom in order of connection
const objNumMap = {
  20:0,
  19:1,
  10:2,
  23:3,
  21:4,
  18:5,
  22:6,
  24:7,
  16:8,
  13:9,
  5:10,
  2:11,
  7:12,
  11:13,
  3:14,
  9:15,
  1:16,
  0:17,
  14:18,
  8:19,
  6:20,
  4:21,
  17:22,
  15:23,
  12:24
}

const parentsx = [-1,0,0,0,0,0,0,6,6,7,7,7,7,12,12,12,12,12,17,17,17,17,17,22,22];

//have to manually fudge the scene graph so we get rotations around the correct joints
const parents = [-1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,22];

//armColors is indexed by obj id in correct order (as opposed to TinkerCad order)
const grey = [.5,.2,1];
const armColors = {21:[.5,.5,1],22:[.6,.3,0],23:grey,24:grey};  //add colors here for different arm segments

// end of arm model stuff

class GPU {
  cameraTypes = {Perspective:0,Orthographic:1}
  renderer;
  renderer2;
  scene;
  camera;
  controls;
  mainLight;
  cameraLight;
  canvas = null;
  canvas2 = null;
  resized = false;
  controls = {};
  pointList = [];
  cameraType = this.cameraTypes.Perspective;
  objNum = 0;
  baryCenters = [];
  objects = [];   //in TinkerCad order right now unfortunately
  labels = [];
  groupBaryCenter;
  pointer = { x: 0, y: 0 };  //raycast mouse pointer in NDC
  measurePoints = [];
  currentMousePoint = null;
  numLines = 0;
  showText = false;
  zoom = 0;
  zoomed = 0;
  doingZoom = false;
  frustumFudge = 1;
  previousHighLighedIndex = -1;
  infoDiv;
  lineSegments=[];
  highlightLine=null;
  lineLabels = [];
  highlightObject=null;
  tinkerCadGroup;
  invObjNumMap = {};  //Tinkercad order to Correct order
  robotNum = 0;
  numRobots = 2;

  //keep a bunch of Vector3 handy so we don't have to thrash memory
  light2Pos = new THREE.Vector3();
  camX = new THREE.Vector3();
  camY = new THREE.Vector3();
  camZ = new THREE.Vector3();
  tempV = new THREE.Vector3();
  wpos = new THREE.Vector3();
  origCam = new THREE.Vector3();
  quat = new THREE.Quaternion();

  constructor(canvas) {

    // local constructor functions ************************************
    const onProgress = function (xhr) {
      if (xhr.lengthComputable) {
        const percentComplete = (xhr.loaded / xhr.total) * 100;
        console.log(Math.round(percentComplete, 2) + "% downloaded");
      }
    };

    function computeBaryCenters(object) {
      object.frustumCulled = false;
      if (object.hasOwnProperty("material")) {
        object.material.side = THREE.DoubleSide;
        this.baryCenters.push(
          this.computeBaryCenter(object.geometry.attributes.position)
        );
        //console.log("parent id",object.parent);
      }
    }

    function centerGroup(object) {
      if (object.hasOwnProperty("material")) {
        object.position.add(this.groupBaryCenter);

        //create a label div which will get filled
        //during render loop
        const label = document.createElement("div");

        const objNumAlias = objNumMap[this.objNum];

        //need this to access original objects in correct order
        this.invObjNumMap[objNumAlias] = this.objNum;

        label.id = "label" + objNumAlias; //this.objNum;
        label.className = "objLabel";

        this.canvas.appendChild(label);
        label.style.display = "none";
        this.labels.push(label);

        object.name = "Object #" + objNumAlias;
        ///console.log("xxx",this.objNum, objNumMap[this.objNum]);
        object.userData.id = objNumAlias;
        object.userData.origNum = this.objNum;

        //object.parent.remove(object);
        this.objects.push(object);

        const objDiv = document.createElement("div");
        objDiv.innerHTML = object.name;
        objDiv.className = "objDiv";
        objDiv.id = "object"+this.objNum;
     
        this.infoDiv.appendChild(objDiv);

        this.objNum++;
      }
    }

    function subtractBaryCenter(object) {
      //the object's vertices coming from TinkerCad are all relative to 0,0,0
      //need to make them relative to its own center
      //console.log('sb ',object.name, object.userData);

      if ( !object.geometry ) return;

      //vertices is actually Float32BufferAttribute object
      let vertices = object.geometry.attributes.position;
      const dim = vertices.itemSize;
      const n = vertices.count;
      let arr = vertices.array;
      const baryTmp = this.baryCenters[object.userData.origNum];

      let p = object.geometry.getAttribute('position');
      for (let i=0; i<p.count; i++) {
        let x = p.getX(i) - baryTmp.x;
        let y = p.getY(i) - baryTmp.y;
        let z = p.getZ(i) - baryTmp.z;
        p.setXYZ(i,x,y,z);
      }

      const center = new THREE.Vector3();
      object.geometry.computeBoundingBox();
      object.geometry.boundingBox.getCenter(center);
      //save the bounded box center for fudging later on
      object.userData.center = new THREE.Vector3().copy(center);

      //now finally move the child into the correct position
      const parentPosition = this.baryCenters[ this.invObjNumMap[parents[object.userData.id]] ];
      //console.log( "parent pos ",object.userData.id, parentPosition)
      
      if (parentPosition) {
        object.position.set( baryTmp.x - parentPosition.x, 
                             baryTmp.y - parentPosition.y,
                             baryTmp.z - parentPosition.z);
      }
      
      //object.geometry.center();  //doing this messes up the alignment
      
      //final tinkering goes here as well so we don't need to loop again through tinkercad
      p.needsUpdate = true;

      //override the materials from TinkerCad
      object.material = this.armMaterial.clone();
      //object.material.color.setRGB(0,1,.5);
      const ac = armColors[object.userData.id];
      if ( ac ) {
        object.material.color.setRGB(ac[0],ac[1],ac[2]);
      }
      object.material.needsUpdate = true;
      object.castShadow = true;
      object.receiveShadow = true;

    }

    // ******************** Main Entry Point ******************************
    function loadObjects(object) {
      //this is the main entry point for the rendering - it is the callback from obj.load

      //this is actually all objects from tinkercad file
      console.log(object);

      object.scale.set(1, 1, 1);

      this.tinkerCadGroup = object;

      //very nice function with callback to get whole scene graph
      this.tinkerCadGroup.traverse(computeBaryCenters.bind(this));

      //we now have the centers of all individual objects
      //now compute the center for the composite object
      this.groupBaryCenter = this.computeCompositeBaryCenter();
      console.log("group center",this.groupBaryCenter);

      this.tinkerCadGroup.traverse(centerGroup.bind(this));

      this.infoDiv.innerHTML += "<hr>";

      /*
      this.baryCenters.forEach((bary) => {
        bary.add(this.groupBaryCenter); //this was messing up object centering
      });
      */

      this.arm = new THREE.Group();
      //add the root element to the arm group
      this.arm.add(this.objects[this.invObjNumMap[0]]);
      //now create a child hierarchy in the correct order
      this.setParents();
      this.arm.traverse(subtractBaryCenter.bind(this));
      this.scene.add(this.arm);

      this.jointSliders = [];
      for (let i=1; i<=8; i++) {
        this.jointSliders.push(document.getElementById("joint0"+i));
      }

      //save robot selector radio buttons for later use
      this.robotButtons = document.querySelectorAll('input[name="robotNum"]');

      //console.log("joint sliders",this.jointSliders);
      this.joints = [22,13,11,14,8,17]; //the tinkercad object numbers of the joints in order from 0 to 4 (1-5 for user)

      this.fortyfiveXZ = new THREE.Vector3(-.9,0,1).normalize();

      this.rootPos = this.objects[20].position;  //parent - all objects are children of children of this
      this.roboCam = this.objects[6]; //robot arm grasper cam object #

      const rootPos = this.rootPos;

      this.currentBigMouseSphere = new THREE.Mesh(this.bigSphere,this.selectPointMaterial);
      this.currentBigMouseSphere.visible = false;
      this.currentBiggerMouseSphere = new THREE.Mesh(this.sphere3,this.pointMaterial2);
      this.currentBiggerMouseSphere.visible = false;

      this.bullseye = new THREE.Mesh(this.bullseyeSphere,this.bullseyeMaterial);
      this.bullseye.name = "Object#Bullseye";

      this.bullseye2 = new THREE.Mesh(this.bullseyeSphere2,this.bullseyeMaterial2);
      this.bullseye2.castShadow = true;

      this.scene.add(this.currentBigMouseSphere);
      this.scene.add(this.currentBiggerMouseSphere);
      this.scene.add(this.bullseye);
      this.scene.add(this.bullseye2);
   
      const railHeight = 30;

      const mirror1 = new THREE.Mesh(  new THREE.BoxGeometry(500, 500, 1)
        , new  THREE.MeshPhongMaterial( {color:"rgb(70,70,150)", shininess:30} ) );

      /*
      const mirror1 = new Reflector(
        new THREE.BoxGeometry(500, 500, 1),
        {
            //clipBias: 0.003,  //what does this do?
            color: "rgb(70,70,150)", side: THREE.DoubleSide,
            receiveShadow: true,
            textureWidth: window.innerWidth * window.devicePixelRatio,
            textureHeight: window.innerHeight * window.devicePixelRatio
        }
      )

      //this is a shader material which sends color via uniforms
      //so create reference at material.color since we use that later in general
      mirror1.material.color = mirror1.material.uniforms.color.value;
      */

      this.groundPlane = mirror1;

      mirror1.receiveShadow = true;
      mirror1.position.z = rootPos.z - railHeight;
      mirror1.name = "Object#102";
      mirror1.userData.id = 102;
      this.scene.add(mirror1);

      const randomMaterial = new THREE.MeshPhongMaterial({color: "rgb(100,0,150)"});
      const tdim = 10;
      const targetObject = new THREE.Mesh(new THREE.BoxGeometry(tdim,tdim,tdim), randomMaterial);
      targetObject.position.set(-50,100,this.groundPlane.position.z+tdim/2);
      targetObject.name = "Object#200";
      targetObject.castShadow = true;
      targetObject.receiveShadow = true;
      this.scene.add(targetObject);

      const railGeo = new THREE.BoxGeometry(11,500,6);
      const railMat = new THREE.MeshPhongMaterial( 
        {color: "rgb(30,70,150)", side: THREE.DoubleSide, shininess: 50 } );
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.receiveShadow = true;
      rail.castShadow = true;
      rail.position.z = rootPos.z - 4;
      rail.position.x = rootPos.x;
      rail.name = "Object#103";
      rail.userData.id = 103;
      this.scene.add( rail );

      const railGeo2 = new THREE.BoxGeometry(2,500,6);
      const rail2 = new THREE.Mesh(railGeo2, railMat);
      rail2.receiveShadow = true;
      rail2.castShadow = true;
      rail2.position.z = rootPos.z + 3;
      rail2.position.x = rootPos.x - 9;
      rail2.name = "Object#104";
      rail2.userData.id=104;
      this.scene.add(rail2);

      const rail3 = rail2.clone();
      rail3.receiveShadow = true;
      rail3.castShadow = true;
      rail3.position.x = rootPos.x + 9;
      rail3.name = "Object#105";
      rail3.userData.id=105;
      this.scene.add(rail3);

      const endGeo = new THREE.BoxGeometry(16,4,10);
      const endRail = new THREE.Mesh(endGeo, railMat);
      endRail.receiveShadow = true;
      endRail.castShadow = true;
      endRail.position.y = 248;
      endRail.position.z = rootPos.z + 4;
      endRail.position.x = rootPos.x;
      endRail.name = "Object#106";
      endRail.userData.id=106;
      this.scene.add(endRail);

      const endRail2 = endRail.clone();
      endRail2.receiveShadow = true;
      endRail2.castShadow = true;
      endRail2.position.y = 210;
      endRail2.name = "Object#107";
      endRail2.userData.id=107;
      this.scene.add(endRail2);

      const endRail3 = endRail.clone();
      endRail3.receiveShadow = true;
      endRail3.castShadow = true;
      endRail3.position.y = -248;
      endRail3.name = "Object#108";
      endRail3.userData.id = 108
      this.scene.add(endRail3);

      const endRail4 = endRail.clone();
      endRail4.receiveShadow = true;
      endRail4.castShadow = true;
      endRail4.position.y = -210;
      endRail4.name = "Object#109";
      endRail4.userData.id=109;
      this.scene.add(endRail4);

      const supportGeo = new THREE.CylinderGeometry( 6, 6, 24, 32 );
      const supportMat = new THREE.MeshPhongMaterial( 
        {color: "rgb(130,70,0)", side: THREE.DoubleSide, shininess: 5 } );
      const support = new THREE.Mesh(supportGeo, supportMat);
      support.position.set(rootPos.x,0,rootPos.z-12-6);
      support.rotation.x = Math.PI/2;

      support.receiveShadow = true;
      support.castShadow = true;
      this.scene.add(support);

      const support2 = support.clone();
      support2.receiveShadow = true;
      support2.castShadow = true;
      support2.position.y = 210;
      this.scene.add(support2);

      const support3 = support.clone();
      support3.receiveShadow = true;
      support3.castShadow = true;
      support3.position.y = -210;
      this.scene.add(support3);

      //const axesHelper = new THREE.AxesHelper( 200 );
      //this.scene.add( axesHelper );
 
      const grid = new THREE.GridHelper(500,50);
      grid.rotation.x = Math.PI/2;
      grid.position.z = rootPos.z - railHeight + 1;
      this.scene.add(grid);

      this.prevAngles = this.blankArray();

      //assuming they start at zero which is not very general
      //we need this to get changes in slider values
      this.prevSliderValues = this.blankArray();
      this.sliderValues = this.blankArray();

      this.savedSliderValues = [];
      for (let i=0; i<this.numRobots; i++) {
        this.savedSliderValues.push(this.blankArray());
      }

      function checkObjId(str) {
        if (str[0]==="o") {  //id starts with (o)bject
          return str.slice(6); //return 6 through end which will be the object #
        }
        else {
          return null;
        }
      }

      function highlightObject(ev) {
        const objId = checkObjId(ev.target.id);
        if (objId) {

          if (this.highlightObject) {
            this.labels[this.highlightObject].style.display="none"; 
          }

          this.highlightObject = objId;
          this.labels[objId].style.display="block"
        }
        else if ( this.highlightObject) {
          this.labels[this.highlightObject].style.display="none";
        }
      }
      function unhighlightObject(ev) {
        const objId = checkObjId(ev.target.id);
        if (this.highlightObject) {
          this.labels[this.highlightObject].style.display="none";
          this.highlightObject = null;
        }
      }

      this.infoDiv.addEventListener("mouseover",highlightObject.bind(this));
      this.infoDiv.addEventListener("mouseleave",unhighlightObject.bind(this));
  
      //finally kick off the render loop - START of ANIMATION and INTERACTION
      this.render();
    }

    function loadMaterials(materials) {
      materials.preload();
      this.objL
        .setMaterials(materials)
        .setPath("./")
        .load("tinker.obj", loadObjects.bind(this), onProgress);
    }

    function checkMouse(ev) {
      const rect = this.canvas.getBoundingClientRect();
      //mouse coords are always in terms of whole screen so need to
      //subtract by top left corner of canvas
      this.pointer.x = ((ev.clientX - rect.left) / this.width) * 2 - 1;
      this.pointer.y = -((ev.clientY - rect.top) / this.height) * 2 + 1;
    }

    //end of local functions *********************************************

    this.canvas = canvas;
    this.canvas2 = canvas2;

    window.addEventListener("resize", this.handleResize.bind(this), false);
    window.addEventListener("keypress", this.handleKeyPress.bind(this), false);
    this.infoDiv = document.getElementById("infoDiv");

    THREE.Cache.clear();

    const canvasDim = canvas.getBoundingClientRect();
    const {width, height} = canvasDim;
    this.width = width;
    this.height = height;

    const canvas2Dim = canvas2.getBoundingClientRect();
    const {width:width2, height:height2} = canvas2Dim;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true});
    this.renderer2 = new THREE.WebGLRenderer({ antialias: true, alpha: true});

    const renderer = this.renderer;

    this.raycaster = new THREE.Raycaster();

    function setRendererOptions(rndr,width,height) {
      rndr.setPixelRatio(window.devicePixelRatio);
      rndr.setSize(width, height, true);
      rndr.setClearColor("rgb(200,200,200)", 1);
  
      rndr.shadowMap.enabled = true;
      rndr.shadowMap.needsUpdate = true;
      rndr.shadowMap.type = THREE.PCFSoftShadowMap; //VSMShadowMap; //PCFSoftShadowMap;
      //VSMShadowMap got rid of all the striping problems ?!@#$#
    }

    setRendererOptions(renderer,width,height);
    setRendererOptions(this.renderer2,width2,height2);

    canvas.appendChild(renderer.domElement);
    this.canvas2.appendChild(this.renderer2.domElement);

    this.scene = new THREE.Scene();

    const aspect = width / height;
    const frustumSize = 200 / this.frustumFudge;
    this.frustumSize = frustumSize;

    switch (this.cameraType) {

      case (this.cameraTypes.Orthographic):

        this.camera = new THREE.OrthographicCamera(
          (-frustumSize * aspect) / 2,
          (frustumSize * aspect)  / 2,
          frustumSize / 2,
          -frustumSize / 2,
          1,
          1000
        );
        break;

      case (this.cameraTypes.Perspective):
        this.camera = new THREE.PerspectiveCamera(70,aspect,.1,2000);
        break;

      default:
        throw new Error (this.cameraType);
    }

    this.camera.position.y = -frustumSize ;
    this.camera.position.z = frustumSize ;

    this.camera.up.set(0, 0, 1);  //camera "up" is originally y-axis
    //orbitControls want to rotate around x and y axes, we want x and z
 
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 500;
    this.controls.zoomSpeed = 1;

    this.mainLight = new THREE.DirectionalLight(0xFFFFFF,.6);
    this.mainLight.position.set(0,0,200); // directly overhead
    this.setShadow(this.mainLight);
    this.scene.add(this.mainLight);

    this.light2 = new THREE.PointLight(0xf0ffff,.3);
    this.setShadow(this.light2);
    this.light2.shadowCameraVisible = true
    this.scene.add(this.light2);
    //light2 tracks camera position but with x and y negated

    this.light3 = new THREE.PointLight(0xffffff, .4);
    this.scene.add(this.camera);
    this.camera.add(this.light3);

    this.camera2 =  new THREE.PerspectiveCamera(90,width2/height2,.1,2000);
    this.camera2.updateProjectionMatrix();
    this.renderer2.setSize(width2, height2);

    //const helper = new THREE.CameraHelper( this.light2.shadow.camera );
    //this.scene.add( helper );
    //const helper = new THREE.CameraHelper( this.camera2 );
    //this.scene.add( helper );

    //adding a light that casts no shadows makes 
    //the directional light softer
    this.scene.add( new THREE.AmbientLight( 0xfff010, 0.3 ) );

    this.canvas.addEventListener("mousemove", checkMouse.bind(this), false);
    this.mouseObjectElem = document.getElementById("mouseObject");
    this.lineObjectElem = document.getElementById("lineObject");

    this.lineMaterial = new THREE.MeshPhongMaterial({
      color: "rgb(25,200,25)",
      shininess: 0,   
    });

    this.selectPointMaterial = new THREE.MeshPhongMaterial({
      color: "rgb(50,100,50)",
      opacity: 1,  //opacity does nothing with Subtractive
      transparent: true,
      blending: THREE.SubtractiveBlending,
      shininess: 0
    });

    this.pointMaterial2 = new THREE.MeshPhongMaterial({
      opacity: .5,
      transparent: true,
      blending: THREE.NormalBlending,
      shininess: 20
    });

    this.pointMaterial3 = new THREE.MeshPhongMaterial({
      opacity: .99,
      shininess: 0
    });

    this.bullseyeMaterial = this.pointMaterial2.clone();
    this.bullseyeMaterial.opacity = .6;
    this.bullseyeMaterial.color.setRGB(1,1,1);
    this.bullseyeMaterial.shininess = 80;

    this.bullseyeMaterial2 = this.pointMaterial3.clone();
    this.bullseyeMaterial2.color.setRGB(0,0,0);

    this.armMaterial = new THREE.MeshPhongMaterial({
      color: "rgb(200,100,0)",
      shininess: 60,
      side: THREE.DoubleSide
    })

    this.up = new THREE.Vector3(0,1,0);
    this.sphere2 = new THREE.SphereGeometry(.8);
    this.sphere3 = new THREE.SphereGeometry(2.);
    this.bigSphere = new THREE.SphereGeometry(1.);
    this.bullseyeSphere = new THREE.BoxGeometry(12,12,12); //new THREE.SphereGeometry(10);
    this.bullseyeSphere2 = new THREE.SphereGeometry(3);
 
    window.GPU = this;

    //load obj or scene from threejs json file
    //threejs editor is superior to tinkercad in a lot of ways
    const loader = new THREE.ObjectLoader();
    function loadJson(obj) {
      //if scene is exported, choose obj.children[0]
      // set obj.children[0].parent = null;
      const newArm = obj;
      const scaleUp = 4.1;
      newArm.rotation.x = Math.PI/2;
      newArm.scale.x = scaleUp;
      newArm.scale.y = scaleUp;
      newArm.scale.z = scaleUp;
      console.log("arm group",obj);

      this.newArm = newArm;
      this.newArm.scaleUp = scaleUp;  //careful changing this - roboCam distance needs to change

      this.scene.add(newArm);

      //chaining callbacks nasty - use async await
      this.mtlL = new MTLLoader();
      this.objL = new OBJLoader();  //need OBJLoader add on for stl,mtl files
      //loadMaterials calls loadObjects as callback which finally kicks off renderLoop
      this.mtlL.setPath("./").load("obj.mtl", loadMaterials.bind(this));

    }

    loader.load(
	    "armModel01.json",
      loadJson.bind(this),
	    function ( xhr ) {
	  	  console.log( (xhr.loaded / xhr.total * 100) + '% loaded' );
	    },
	    function ( err ) {
		    console.error( 'An error happened' );
	    }
    );

  }

  //start of class methods ****************************
  blankArray(n=this.objects.length) {
    return Array(n).fill(0)
  }

  setParents() {
    const origOrder = Object.keys(this.invObjNumMap);

    for (let i=1; i<origOrder.length; i++) {
        //console.log("parent of ",this.invObjNumMap[i]," is ", this.invObjNumMap[parents[i]]);
        //this.objects[ this.invObjNumMap[parents[i]] ].attach( this.objects[ this.invObjNumMap[i]] );
        this.objects[ this.invObjNumMap[parents[i]] ].add( this.objects[ this.invObjNumMap[i]] );
    }
  }

  computeBaryCenter(vertices) {
    //vertices is actually Float32BufferAttribute object
    const dim = vertices.itemSize;
    const n = vertices.count;
    const arr = vertices.array;
    const bary = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < dim; j++) {
        bary[j] += arr[i * dim + j];
      }
    }

    for (let j = 0; j < dim; j++) {
      bary[j] /= n;
    }
    return new THREE.Vector3(bary[0], bary[1], bary[2]);
  }

  computeCompositeBaryCenterOld() {
    //more convenient to use Vector3, see computeCompositeBaryCenter
    const dim = this.baryCenters[0].length;
    const bary = [0, 0, 0];
    for (const center of this.baryCenters) {
      for (let j = 0; j < dim; j++) {
        bary[j] += center[j];
      }
    }

    //console.log("composite baryCenter");
    for (let j = 0; j < dim; j++) {
      bary[j] /= this.baryCenters.length;
    }

    return new THREE.Vector3(-bary[0], -bary[1], -bary[2]);
  }

  computeCompositeBaryCenter() {
    const compBary = new THREE.Vector3();
    for (const center of this.baryCenters) {
      compBary.add(center);
    }
    compBary.multiplyScalar(-1 / this.baryCenters.length);
    return compBary;
  }

  cylinderMesh(pointX, pointY) {
    // edge from X to Y
    const edge = new THREE.Vector3().subVectors(pointY, pointX);
    // cylinder: radiusAtTop, radiusAtBottom,
    // height, radiusSegments, heightSegments
    const edgeGeometry = new THREE.CylinderGeometry(
      .5,
      .5,
      edge.length(),
      4,
      1
    );
    
    const mesh = new THREE.Mesh(edgeGeometry,this.lineMaterial);
    const axis = this.up; //axis of cyl starts at UP
    mesh.quaternion.setFromUnitVectors(axis, edge.clone().normalize());

    const edgePos = new THREE.Vector3()
      .addVectors(pointX,edge.multiplyScalar(.5));

    mesh.position.copy(edgePos);
    mesh.edgeLength = edge.length();

    this.lineObjectElem.innerHTML = this.lineLength(this.numLines,mesh.edgeLength);

    return mesh;
  }

  lineLength(lineNum, lineLen) {
    return "<p><br>Line # and Length is: " + lineNum + ", " + 2 * Math.trunc(lineLen*1000)/1000 + "</p>";
  }

  handleKeyPress(ev) {

    function rr(cc) {
      return Math.trunc(cc*10000)/10000;
    }

    //keys m and z are for add measuring points and for zooming in and out
    if (ev.keyCode === 109) {  //key m
      //console.log("measuring");
      if (this.currentMousePoint) {
        this.measurePoints.push(this.currentMousePoint);
        const newPoint = new THREE.Mesh(this.sphere2,this.lineMaterial);
        newPoint.position.copy(this.currentMousePoint);
        this.scene.add(newPoint);
        if (this.measurePoints.length > 1) {
          //add a cylinder from current to previous
          const prev = this.measurePoints.length - 2;
          const newEdge = this.cylinderMesh(
            this.measurePoints[prev],this.currentMousePoint);

          //console.log("edge points",this.measurePoints[prev], this.currentMousePoint);

          newEdge.name = "line " + this.numLines;
          newEdge.index = this.numLines;

          this.lineSegments.push(newEdge);
          this.numLines ++;

          //console.log(newEdge)
          this.scene.add(newEdge);
          newEdge.castShadow = true;
          newEdge.receiveShadow = true;

          const label = document.createElement("div");
          label.id = "line" + newEdge.index;
          label.className = "objLabel";  
          this.canvas.appendChild(label);
          label.style.display = "none";

          this.lineLabels.push(label);

          const lineDiv = document.createElement("div");
          lineDiv.innerHTML = newEdge.name + ", " + 2 * rr(newEdge.edgeLength);
          lineDiv.className = "objDiv";
          lineDiv.id = newEdge.index;

          function highlightLine(ev) {
            this.highlightLine = ev.target.id;
            this.lineLabels[ev.target.id].style.display="block";
  
          }
          function unhighlightLine(ev) {
            this.lineLabels[ev.target.id].style.display="none";
            this.highlightLine = null;
          }

          lineDiv.addEventListener("mouseover",highlightLine.bind(this));
          lineDiv.addEventListener("mouseleave",unhighlightLine.bind(this));

          this.infoDiv.appendChild(lineDiv);
          this.infoDiv.scrollTop = 1000;

        }
      }
    }
    else if (ev.keyCode === 122) {  //key z
      this.zoom ^= 1;  //zoom out or in
      this.doingZoom = true;
      this.handleResize();
    }
  }

  handleResize(evt) {

    if (this.cameraType === this.cameraTypes.Orthographic) {
      this.handleResizeOrtho(evt);
      return;
    }

    const canvasDim = this.canvas.getBoundingClientRect();
    const {width, height} = canvasDim;

    this.width = width;
    this.height = height;

    const canvas2Dim = this.canvas2.getBoundingClientRect();

    const {width:width2, height:height2} = canvas2Dim;

    //zooming for Perspective vs Orthographic is different so different code here
    let zoomMult = 1;

    if (this.doingZoom) {
      zoomMult = (this.zoom === 0 ) ? 1 : 6;
      if ( zoomMult > 1 && this.currentMousePoint) {

        //zooming in on a point is more complicated in perspective projection
        this.camera.getWorldPosition(this.tempV);
        this.origCam.copy(this.tempV);
        this.currentBigMouseSphere.getWorldPosition(this.wpos);
        this.tempV.sub(this.wpos); //get vector from cam to target point
        const ln = this.tempV.length(); //get the length
        this.tempV.normalize().multiplyScalar(ln/1.2); //don't overshoot or else camera view flips
        this.camera.position.sub(this.tempV); //move the camera along the vector from above
        this.controls.target.copy(this.wpos); //reset the lookAt target of controls  
        this.zoomed = 1;

      }
      else if (this.zoomed) {
        //check that we actually had zoomed out
        this.camera.position.copy(this.origCam); //retrieve the original cam pos
        this.controls.target.set(0,0,0);
        this.zoomed = 0;
      }
      this.doingZoom = false;
    }
    
    //console.log(this)  don't forget to bind the GPU this context to callback functions
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    this.camera2.aspect = width2 / height2;
    this.camera2.updateProjectionMatrix();
    this.renderer2.setSize(width2, height2);

    this.controls.update();
  }

  handleResizeOrtho() {
    const canvasDim = canvas.getBoundingClientRect();
    const [width, height] = [canvasDim.width, canvasDim.height];
    this.width = width;
    this.height = height;

    let zoomMult = 1;
    if (this.doingZoom) {
      zoomMult = (this.zoom === 0 ) ? 1 : 6;
      if ( zoomMult > 1 && this.currentMousePoint) {
        this.controls.target.copy(this.currentMousePoint);
        this.zoomed = 1;
      }
      else if (this.zoomed) {
        this.controls.target.set(0,0,0);
        this.zoomed = 0;
      }
      this.doingZoom = false;
    }
    
    const aspect = width / height;
    this.camera.left = (-this.frustumSize * aspect) / 2 / zoomMult;
    this.camera.right = (this.frustumSize * aspect) / 2 / zoomMult;
    this.camera.top = this.frustumSize / 2 / zoomMult;
    this.camera.bottom = -this.frustumSize / 2 / zoomMult;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    this.controls.update();

  }

  setShadow(light) {
    light.castShadow = true;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 2000;
    light.shadow.normalBias = .7;  //offset along surface normal for shadow
    //light.shadow.bias = .0002  //offset for deciding whether surface is in shadow
    //light.shadow.blurSamples = 64;

    //have to set the range of the orthographic shadow camera
    //to cover the whole plane we are casting shadows onto
    //the shadows get fuzzier if these limits are much greater than the scene
    light.shadow.camera.left = -500;
    light.shadow.camera.bottom = -500;
    light.shadow.camera.right = 500;
    light.shadow.camera.top = 500;
  }

  setTextOrtho(textElem, vec3, text) {
    //we can make text follow objects by applying projection to center of object
  
    const tempV = this.tempV; //new THREE.Vector3();
    tempV.copy(vec3);

    tempV.project(this.camera); //gets us to the NDC coords/Clip Space for the center of this object

    const textX = (tempV.x * 0.5 + 0.5) * this.width; // NDC to pixel coords in div
    const textY = -(tempV.y * 0.5 + 0.5) * this.height; //CSS coords are opposite in Y direction

    //console.log(textX, textY)
    textElem.style.position = "absolute";
    textElem.textContent = text;
    textElem.style.color = "white";
    textElem.style.transform = `translate(-50%, -50%) translate(${textX}px,${textY}px)`;
    textElem.style.zIndex = ((-tempV.z * 0.5 + 0.5) * 100000) | 0;
  }

  SV(n) { //stupid function to process slider values
    return this.jointSliders[n].value/50-1;
  }

  getSliderValues() {
    for (let i=0; i<this.jointSliders.length; i++) {
      this.sliderValues[i] = this.SV(i);
    }
  }

  updateSliderValues(arr) {
    for (let i=0; i<this.jointSliders.length; i++) {
      this.jointSliders[i].value = (arr[i]+1)*50;
    }   
  }

  raycastFromCameraToMouse() {

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const mousePicker = this.raycaster.intersectObjects(this.scene.children);
    this.currentBigMouseSphere.visible = false;  
    this.currentBiggerMouseSphere.visible = false;  

    this.currentMousePoint = null;

    if (mousePicker.length > 0 ) {

      //console.log(mousePicker[0])

      let pointToUse = mousePicker[0];
      for (const point of mousePicker) {

        if (point.object.edgeLength) {
          this.lineObjectElem.innerHTML = "";
          this.lineObjectElem.innerHTML = this.lineLength(point.object.index, point.object.edgeLength);
        }

        //only pick the coordinates of actual points in the original objects or else
        //we wind up making new vertices on the line segments
        if ( String(point.object.name).includes("Object") ) {

          this.mouseObjectElem.innerHTML = "";
          pointToUse = point;

          this.currentBigMouseSphere.visible = true;
          this.currentBigMouseSphere.position.copy(point.point);

          this.currentBiggerMouseSphere.visible = true;
          this.currentBiggerMouseSphere.position.copy(point.point);

          //nb: .color may have been redirected to point to: object.material.uniforms.color.value
          //not anymore - only in the case of custom shader material
          const cc = pointToUse.object.material.color;
          let colorToUse = cc;

          function ET(cc) {  //(E)xponential (T)one map
            return 1 - Math.exp(-cc);
          }

          if ( !pointToUse.object.material.color) {console.log(cc)};

          if ( 
                (cc  && (!cc.hasOwnProperty("highlighted") ||
                (cc.hasOwnProperty("highlighted") && !cc.highlighted )))) {

            //if something is already highlighted we need to know it's index
            if ( this.currentHighLighted ) {
              this.previousHighLighedIndex = this.currentHighLighted.index;
              this.currentHighLighted.material.color.copy(this.previousColor);
              this.currentHighLighted.material.color.highlighted = false;
            }

            const sc = 4;
            this.previousColor = new THREE.Color().copy(cc);
            const highlightColor = new THREE.Color(ET(cc.r*sc),ET(cc.g*sc),ET(cc.b*sc));

            const isGroundPlane = point.object.name == "Object#102";
            //don't highlight the ground plane - too annoying
            if (!isGroundPlane) cc.set(highlightColor);
            cc.highlighted = true;
            this.currentHighLighted = pointToUse.object;
            colorToUse = highlightColor;
          }

          //this is static move out of loop and do only once
          const newColor = new THREE.Color(1-colorToUse.r,1-colorToUse.g,1-colorToUse.b);
          this.currentBiggerMouseSphere.material.color.set(newColor);

          function rr(cc) {
            return Math.trunc(cc*1000)/1000;
          }
          this.mouseObjectElem.innerHTML +=
          "<p>" +
          pointToUse.object.name +
          "<br><br>Point<br>" +
          JSON.stringify(pointToUse.point) +
          "<br><br>Face<br>" +
          JSON.stringify(pointToUse.face) +
          "<br><br>Color<br>" +
          " red: "   + rr(this.previousColor.r) +
          " green: " + rr(this.previousColor.g) +
          " blue: "  + rr(this.previousColor.b)
          "</p>";
          break;
        }
      }        

      //check if new point is very close to one that exists
      //if it is use the exact position for that point
      this.currentMousePoint = pointToUse.point;

    }

    if ( !this.currentMousePoint ) {
      //if we get here we have to reset the color of the previous highlighted object
      if (this.currentHighLighted) {
        this.currentHighLighted.material.color.copy(this.previousColor);
        this.currentHighLighted.material.color.highlighted = false;
        this.currentHighLighted = null;
      }
    }

    if (this.highlightObject) {
      const i = this.highlightObject;
      const obj = this.objects[i];
      const textElem = this.labels[i];
      const text = "obj#" + i;
      
      obj.getWorldPosition(this.wpos);  //world position is now actually centered on the object and not 0,0,0
      //this.setTextOrtho(textElem, this.baryCenters[i], text);
      this.setTextOrtho(textElem, this.wpos, text);
    }

    if (this.highlightLine) {
      const textElem = this.lineLabels[this.highlightLine];
      const obj = this.lineSegments[this.highlightLine];
      const text = "line#" + this.highlightLine;
      this.setTextOrtho(textElem, obj.position, text);
    }

  }

  animateArm(time) {
      //this.SV is the function to retrieve (S)lider (V)alues
      const baseJoint = this.joints[0]; //object #20
      this.objects[baseJoint].setRotationFromAxisAngle(this.fortyfiveXZ,this.sliderValues[0]*Math.PI);

      for (let i=1; i<3; i++) {
        this.prevAngles[this.joints[i]] = this.objects[this.joints[i]].rotation.y;
        this.objects[this.joints[i]].rotation.y = this.sliderValues[i]*Math.PI;
      }

      const j1 = this.joints[1];
      if (this.prevAngles[j1] != this.objects[j1].rotation.y) {
        this.objects[this.joints[3]].rotation.y -= (this.objects[j1].rotation.y-this.prevAngles[j1]);
      }

      //keep joint 3 at same angle relative to ground - we will need to do this for every joint at some point
      const j2 = this.joints[2];
      const j3 = this.joints[3];
      if (this.prevAngles[j2] != this.objects[j2].rotation.y) {
        this.objects[j3].rotation.y -= (this.objects[j2].rotation.y-this.prevAngles[j2]);
      }
      this.prevAngles[j3] = this.objects[j3].rotation.y;
      const newAngle = this.sliderValues[3]*Math.PI;
      const deltaAngle = newAngle - this.prevSliderValues[j3];
      this.prevSliderValues[j3] = newAngle;
      this.objects[j3].rotation.y += deltaAngle;

      this.objects[this.joints[4]].rotation.x = this.sliderValues[4]*Math.PI;
      this.objects[this.joints[5]].rotation.z = this.sliderValues[5]*Math.PI;

      //grasper
      this.objects[15].position.y = 6 + this.sliderValues[6]*6;
      this.objects[12].position.y = -6 - this.sliderValues[6]*6;

      this.rootPos.y = -this.sliderValues[7]*200;  //root position translation along rail

      //grasper cam view - #22 is the rail for the 2 grasper claws
      this.objects[17].getWorldPosition(this.wpos); 
      this.setBullsEyePos(this.wpos);
   
      // ************ roboCam adjustment *****************
      const roboCam = this.roboCam;
      roboCam.getWorldPosition(this.wpos);
      this.camera2.position.copy(this.wpos);

      //we need to step a little bit down the "z" axis of camera
      //which of course is the 3rd row of the World View matrix

      roboCam.getWorldQuaternion(this.quat);
      this.camera2.rotation.setFromQuaternion(this.quat);

      this.camZ.set(0,0,-1);
      this.camZ.applyQuaternion(this.quat);
      this.camZ.multiplyScalar(20.5);
      this.camera2.position.add(this.camZ);

  }

  animateArm2(time) {
     //so far we have different processes for the models created by different
     //programs , need to create an adapter 
    for (let i=0; i<7; i++) {
      this.newArm.joints[i].rotation.y = this.sliderValues[i]*Math.PI;
    }

    this.newArm.grasper.root.getWorldPosition(this.wpos);
    this.setBullsEyePos(this.wpos);

    // ******* roboCam adjustment ************************
    const roboCam = this.newArm.roboCamRef;
            
    roboCam.getWorldPosition(this.wpos);
    this.camera2.position.copy(this.wpos);

    //have to rotate around the robocam joint by -90 before getting the World Quat
    //to get camera to point in correct direction
    roboCam.visible = false;
    roboCam.rotation.y -= Math.PI/2;
    roboCam.getWorldQuaternion(this.quat);
    roboCam.rotation.y += Math.PI/2;
    roboCam.visible = true;
    //then we have to restore it

    this.camera2.rotation.setFromQuaternion(this.quat);

    this.camZ.set(0,0,-1);
    this.camZ.applyQuaternion(this.quat);
    this.camZ.multiplyScalar(20.5);
    this.camera2.position.add(this.camZ);

  }

  setBullsEyePos(wpos) {
    this.bullseye.position.set(wpos.x,wpos.y,0); //copy(this.wpos);  //object #22
    this.bullseye.position.z = this.groundPlane.position.z + this.bullseye.geometry.parameters.depth/2;
    this.bullseye2.position.copy(this.bullseye.position);
  }

  traverseGroup(node) {
    if (node) {
      //console.log('zzzzzzzzzzz',node.name??"xxx", node.children.length);
      if (node.name.substr(0,5) === "joint") {
        console.log("found a joint", node.name);

        const jointData = node.name.split("#");

        if (jointData[1] === "grasper" ) {
          if (jointData[2] === "root") {
            this.newArm.grasper.root = node;
            //this.newArm.roboCam = node;
          }
          else if ( jointData[2] === "1") {
            this.newArm.grasper.claw01 = node;
          }
          else if ( jointData[2] === "2") {
            this.newArm.grasper.claw02 = node;
          }
        }
        else if (jointData[1] === "robocam") {
          //this is the location for tracking robot camera
          this.newArm.roboCam = node;
        }
        else if (jointData[1] === "robocamref") {
          this.newArm.roboCamRef = node;  
        }
        else {
          this.newArm.joints.push(node);
        }
      }
      if ( node.children && node.children.length > 0) { node.children.forEach(x=>this.traverseGroup(x))}
    }
  }

  getRobotNum() {
    for (const robotButton of this.robotButtons) {
      if (robotButton.checked) {
        return robotButton.value - 1;
        break;
      }
    }

    throw new Error ("something aweful happened with selecting a Robot");
  }

  finalInitialization() {
    //do final initialization of stuff here
    this.newArm.joints = [];
    this.newArm.grasper = [];
    this.traverseGroup(this.newArm);
    
    //console.log("grasper",this.newArm.grasper);
    //remember that this whole group is scaled up by a factor of 4
    this.newArm.position.set(-80,50,this.groundPlane.position.z);
    //this.newArm.rotation.z = Math.PI/4;
    //this.newArm.joints[0].rotation.y = -Math.PI/2 + Math.PI;
    //this.newArm.joints[1].rotation.y = Math.PI/4;
    //this.newArm.joints[4].rotation.y = -Math.PI/2;
    //this.newArm.joints[5].rotation.y = -Math.PI/2;
    //this.newArm.joints[6].rotation.y = Math.PI/2;

    this.getSliderValues();
    //prevent memory thrashing - do a hard copy
    this.copySliderValues(this.savedSliderValues[0]);
  }

  copySliderValues(arr) {
    for (let i=0; i<this.jointSliders.length; i++) {
      arr[i] = this.sliderValues[i];
    }
  }

  adjustCamLight() {
        //negate x and y of camera pos so we always see point light shadow in the main view
        this.camera.getWorldPosition(this.wpos);
        this.wpos.x *= -1;
        this.wpos.y *= -1;
        this.wpos.z *= 2;
        this.light2.position.copy(this.wpos);
  }

  render() {

    this.finalInitialization();

    //do some FPS book keeping
    console.log("in render");
    let prevRenderTime = Date.now();
    const fps = 80;
    const fpsInterval = 1000 / fps;
    let frameCount = 0;
    requestAnimationFrame(renderLoop.bind(this));

    function renderLoop(time) {

      //keep render loop lean - only call functions - no real code
      requestAnimationFrame(renderLoop.bind(this));

      //throttle the fps because without it just maxes
      //out the GPU for no good reason, for example it will
      //redisplay the same scene at 240 fps on this computer
      const currentRenderTime = Date.now();
      const elapsed = currentRenderTime - prevRenderTime;
      if (elapsed < fpsInterval) return;
      prevRenderTime = currentRenderTime - (elapsed % fpsInterval);
      time *= 0.001; //convert from milliseconds to seconds
      frameCount++;

      this.getSliderValues();

      const prevRobotNum = this.robotNum;
      this.robotNum = this.getRobotNum();
      if ( prevRobotNum !== this.robotNum) {
        this.copySliderValues(this.savedSliderValues[prevRobotNum]);
        
        this.updateSliderValues(this.savedSliderValues[this.robotNum]);
        this.getSliderValues();

        console.log("we switched robots to ",this.robotNum);
      }

      this.raycastFromCameraToMouse();
      
      if (this.robotNum === 0) {
        this.animateArm(time);
      }
      else if (this.robotNum === 1) {
        this.animateArm2(time);
      }

      this.adjustCamLight();

      this.controls.update();

      this.renderer.render(this.scene, this.camera);

      this.renderer2.render(this.scene, this.camera2);

    }
  }

}

export default GPU