

const Vec2 = require("genvector").Vec2;


export class BaseMap {
    scrollSpeed = 1;
    minScale = 0.02;
    maxScale = 100;
    clickDistanceThreshold = 8;
    mapSize = 10000; // Just affects text highlighting when going outside
    defaultOffset = new Vec2(-this.mapSize);
    defaultScale = 1;
    keyCommandMoveMapSpeed = 40;
    keyCommandZoomMapSpeed = 0.3;

    constructor(name) {
        this.name = name;

        this.localStore("saveMinI", this.localStore("saveMinI") || 1);
        this.localStore("saveCurI", this.localStore("saveCurI") || 0);
        this.localStore("saveMaxI", this.localStore("saveMaxI") || 0);

        this.mapContainer = createEle(document.body, "div", "mapContainer");
        this.map = createEle(this.mapContainer, "div", "map");

        this.mouseDownMouse = null;
        this.hasDraggedOverThreshold = true;
        this.dragStartCoords = null;
        this.dragStartMouse = null;
        this.lastMoveCoords = new Vec2(0);

        this.mapContainer.addEventListener("touchstart", this.touchStart.bind(this));
        this.mapContainer.addEventListener("touchmove", this.touchMove.bind(this));
        this.mapContainer.addEventListener("touchend", this.touchEnd.bind(this));

        this.mapContainer.addEventListener("mousedown", this.mouseDown.bind(this));
        this.mapContainer.addEventListener("mousemove", this.mouseMove.bind(this));
        this.mapContainer.addEventListener("mouseup", this.mouseUp.bind(this));
        this.mapContainer.addEventListener("mouseleave", this.mouseLeave.bind(this));

        this.mapContainer.addEventListener("wheel", this.wheel.bind(this));

        this.mapContainer.addEventListener("scroll", function() {this.mapContainer.scrollTop = 0;}.bind(this))  // Prevent keyboard appearing from scrolling

        addEventListener("keydown", this.keyDown.bind(this));

        this.offset = new Vec2(this.localStore("offset") || this.defaultOffset);
        this.scale = this.localStore("scale") || this.defaultScale;

        this.map.setSize(this.mapSize * 2);

        this.eles = [];

        this.updateMap();

        this.menu = new Menu(this.mapContainer, this.name);
        this.menu.addMenuBool("Dark mode", this.darkMode.bind(this), "darkmode");
        this.menuUndo = this.menu.addMenuButton("Undo", this.undo.bind(this), "undo");
        this.menuRedo = this.menu.addMenuButton("Redo", this.redo.bind(this), "redo");
        this.menuReset = this.menu.addMenuButton("Reset", this.resetMap.bind(this), "reset");
        this._styleUndoButtons();

        this.db = null;
        this._dbName = "map_" + this.name;
        this._dbStoreName = "map";
        // this._dbStoreQueue = [];
        this.openDB();
    }

    hookClick(event, coords) {}

    hookMouseDown(event, coords) {}
    hookMouseUp(event, coords) {}
    hookMouseMoving(event, coords) {}

    hookThresholdDragStart(event) {}
    hookThresholdDragStop(event) {}

    hookChangedCamera() {
        this.localStore("offset", this.offset);
        this.localStore("scale", this.scale);

        // this.debug("center", this.centerCoords());
        // this.debug("0", 0);
    }

    hookInitialized() {}

    // hookEleCreate(ele) {console.log("Create", ele)}
    // hookEleUpdate(ele) {console.log("Update", ele)}
    // hookEleDelete(ele) {console.log("Delete", ele)}
    hookEleCreate(ele) {}
    hookEleUpdate(ele) {}
    hookEleDelete(ele) {}

    checkCanDrag() {return true;}
    checkCanDoKeyCommands() {return true;}

    centerCoords() {
        return this.globalToLocalCoords(this.mapContainer.getGlobalPos());
    }

    globalToLocalCoords(globalVec2) {
        return globalVec2.sub(this.mapContainer.getGlobalPos(true)).div(this.scale).sub(this.offset);
    }

    focusEle(ele, moveUp=false) {
        this.scale = 1;
        this.updateScroll();
        const yAdd = (moveUp ? (this.mapContainer.getFullSize().y - ele.getSize().y) / 3 : 0);
        this.moveMap(this.centerCoords().sub(ele.getPos().add(0, yAdd)));
    }

    debug(name, coords) {
        name = "debugging-" + name;
        if (!this[name]) {
            this[name] = this.createEle("div", 0, 10, "debug");
        }
        this[name].setPos(coords);
    }

    resetMap() {
        if (confirm("Really reset everything?")) {
            localStorage.clear();
            this.clearDB();
            location.reload();
        }
    }

    darkMode(enabled) {
        const root = document.querySelector(":root");
        const names = getAllCSSVariableNames();
        const suffix = enabled ? "Dark" : "Light";
        for (const x of names) {
            if (!x.endsWith("Light") && !x.endsWith("Dark") && names.includes(x + "Light") && names.includes(x + "Dark")) {
                root.style.setProperty(x, "var(" + x + suffix + ")");
            }
        }
    }

    clearDB() {
        if (this.db) {
            this.db.close();
        }

        let req = indexedDB.deleteDatabase(this._dbName);
        req.onsuccess = function () {
            console.log("Deleted database successfully");
        };
        req.onerror = function () {
            console.log("Couldn't delete database");
        };
        req.onblocked = function () {
            console.log("Couldn't delete database due to the operation being blocked");
        };
    }

    openDB() {
        let openRequest = indexedDB.open(this._dbName, 1);

        openRequest.onerror = function() {
            console.error("DB error", openRequest.error);
        }.bind(this);

        openRequest.onupgradeneeded = function() {
            console.log("Upgrading DB");
            let db = openRequest.result;
            if (!db.objectStoreNames.contains("map")) {
                db.createObjectStore("map", {keyPath: "key"});
            }
        }.bind(this);

        openRequest.onsuccess = function() {
            console.log("Success DB");
            this.db = openRequest.result;

            this.hookInitialized();

            // for (const queue of this._dbStoreQueue) {
            //     this.dbStore(queue.key, queue.value, queue.successFunc);
            // }

            // console.log(this.db.objectStoreNames)
        }.bind(this);
    }

    async dbStore(key, value=null, successFunc=null) {
        if (successFunc) {
            successFunc = successFunc.bind(this);
        }

        if (this.db === null) {
            // this._dbStoreQueue.push({key: key, value: value, successFunc: successFunc});
            console.error("DB isn't created yet, use hookInitialized");
            // console.log("Queued dbStore as db isn't created yet");
            return
        }
        let transaction = this.db.transaction(this._dbStoreName, value === null ? "readonly" : "readwrite");
        let store = transaction.objectStore(this._dbStoreName);

        if (value === null) {
            // console.log(key, this.localStore("saveCurI"));
            let request = store.get(key);
            request.onsuccess = async function(e) {
                console.log("Successfully read item", key);
                if (successFunc) {
                    console.log(request.result);
                    successFunc(request.result ? request.result.value : await compress("[]"));
                }
            }.bind(this);

            request.onerror = function() {
                console.log("Error reading item", request.error);
            }.bind(this);
        }
        else {
            let request = store.put({key: key, value: value});
            // console.log(value);
            request.onsuccess = function() {
                console.log("Successfully stored item", request.result);
            }.bind(this);

            request.onerror = function() {
                console.log("Error saving item", request.error);
                // if (request.error.name === "ConstraintError") {
                //     console.log("Book with such id already exists"); // handle the error
                //     event.preventDefault(); // don't abort the transaction
                //     event.stopPropagation(); // don't bubble error up, "chew" it
                // } else {
                //     // do nothing
                //     // transaction will be aborted
                //     // we can take care of error in transaction.onabort
                // }
            }.bind(this);
        }
    }

    localStore(key, value=null) {
        const newKey = this.name + key;
        if (value === null) {
            value = localStorage.getItem(newKey);
            if (value === parseFloat(value).toString()) value = parseFloat(value);
            return value;
        }
        else {
            while (true) {
                let stop = true;
                try {
                    localStorage.setItem(newKey, value);
                }
                catch (error) {
                    // console.log("Dropped save " + this.localStore("saveMinI"));
                    if (this.localStore("saveMinI") === this.localStore("saveCurI")) {
                        alert("Error: Unable to save.");
                        break;
                    }
                    this.storeRemove(this.localStore("saveMinI"));
                    this.localStore("saveMinI", this.localStore("saveMinI") + 1);
                    stop = false;
                }
                if (stop) break;
            }
        }
    }

    storeRemove(key) {
        key = this.name + key;
        localStorage.removeItem(key);
    }

    eleToDict(ele) {
        return {
            tag: ele.tagName,
            pos: ele["getPos"](),
            size: ele.getSize(),
            classname: ele.className,
            fullSize: ele.getFullSize()
        };
    }

    dictToEle(dict) {
        return this.createEle(dict.tag, dict.pos, dict.size, dict.classname, true);
    }

    _dispatchMouse(eventName) {
        const vec2 = this.lastMoveMouse;
        if (!vec2) return;
        this.mapContainer.dispatchEvent(new MouseEvent(eventName, {clientX: vec2.x, clientY: vec2.y}));
    }

    keyDown(event) {
        if (this.checkCanDoKeyCommands()) {
            if (event.ctrlKey) {
                if (event.keyCode === 90) this.undo();
                if (event.keyCode === 89) this.redo();
            }
            this._clickMapWithKeys(event);
            this._moveMapWithKeys(event);
            this._scrollMapWithKeys(event);
        }
    }

    _clickMapWithKeys(event) {
        if ([13, 32].includes(event.keyCode)) {
            event.preventDefault();
            this._dispatchMouse("mousedown");
            this._dispatchMouse("mouseup");
        }
    }

    _scrollMapWithKeys(event) {
        if (!this.lastMoveCoords) return;
        const key = event.keyCode;
        if ([81, 69].includes(key)) {
            if (key === 81) this.scroll(this.lastMoveMouse, this.keyCommandZoomMapSpeed);
            if (key === 69) this.scroll(this.lastMoveMouse, -this.keyCommandZoomMapSpeed);
        }
    }

    _moveMapWithKeys(event) {
        const key = event.keyCode;
        const move = new Vec2(([37, 65].includes(key)?1:0)-([39, 68].includes(key)?1:0), ([38, 87].includes(key)?1:0)-([40, 83].includes(key)?1:0)).mul(this.keyCommandMoveMapSpeed / this.scale);
        if (!move.equals(0)) {
            this.moveMap(move);
            this._dispatchMouse("mousemove")
        }
    }

    _styleUndoButtons() {
        // console.log(this.localStore("saveMinI"), this.localStore("saveCurI"), this.localStore("saveMaxI"));
        this.menuUndo.disabled = this.localStore("saveCurI") === this.localStore("saveMinI");
        this.menuRedo.disabled = this.localStore("saveCurI") === this.localStore("saveMaxI");
    }

    undo() {
        console.log(this.localStore("saveCurI"), this.localStore("saveMinI"), this.localStore("saveMaxI"))
        if (this.localStore("saveCurI") > this.localStore("saveMinI")) {
            this.localStore("saveCurI", this.localStore("saveCurI") - 1);
            this._styleUndoButtons();
            this.load();
        }
    }

    redo() {
        if (this.localStore("saveCurI") < this.localStore("saveMaxI")) {
            this.localStore("saveCurI", this.localStore("saveCurI") + 1);
            this._styleUndoButtons();
            this.load();
        }
    }

    async save() {
        if (this.loadStartTime) {
            // console.log("Not allowing save because currently loading")
            return;
        }

        const startTime = performance.now();

        this.localStore("saveCurI", this.localStore("saveCurI") + 1);
        this.localStore("saveMaxI", this.localStore("saveCurI"));  // Remove possible branch
        this._styleUndoButtons();

        // const exceedingSaves = this.localStore("saveCurI") - this.localStore("saveMinI") - 5;
        // if (exceedingSaves > 0) {
        //     for (let i=0; i < exceedingSaves; i++) {
        //         this.storeRemove(this.localStore("saveMinI") + i);
        //     }
        //     this.localStore("saveMinI", this.localStore("saveMinI") + exceedingSaves);
        // }


        const dictList = [];
        for (const ele of this.eles) {
            if (ele.save) {
                dictList.push(this.eleToDict(ele))
            }
        }
        let data = JSON.stringify(dictList);

        data = await compress(data);

        await this.dbStore(this.localStore("saveCurI"), data);

        // console.log(`Save took ${performance.now() - startTime} milliseconds`)

        return data;
    }

    async load(data=null) {
        if (data === null) {
            await this.dbStore(this.localStore("saveCurI"), null, this.load);
            return;
        }

        if (data === undefined) {  // I think that an empty db entry will return undefined, not null
            // this.save();  // Was this to have the initial empty save slot to make undo empty map?
            return;
        }


        this.loadStartTime = performance.now();

        this.clearEles();

        data = await decompress(data);

        const array = JSON.parse(data);  // HERE ** Try compressing!

        for (const dict of array) {
            this.dictToEle(dict);
        }
        // console.log(`Load took ${performance.now() - this.loadStartTime} milliseconds`)
        this.loadStartTime = null;
    }

    clearEles(onlySaveable=true) {
        for (const ele of [...this.eles]) {
            if (!onlySaveable || ele.save) {
                this.removeEle(ele);
            }
        }
    }

    createEle(tag, pos, size, classname, save=false) {
        const ele = createEle(this.map, tag, classname);
        ele.setSize(size);
        ele.setPos(pos);
        ele.save = save;
        this.addEle(ele);
        return ele;
    }

    addEle(ele) {
        if (this.eles.indexOf(ele) === -1) {
            this.eles.push(ele);
            this.hookEleCreate(ele);
        }
    }

    removeEle(ele) {
        const index = this.eles.indexOf(ele);
        if (index !== -1) {
            this.eles.splice(index, 1);
            this.hookEleDelete(ele);
            ele.remove();
        }
    }

    updateScroll() {
        this.map.style.transform = "scale(" + this.scale + ")";
    }

    updateMap() {
        this.moveMap(0);
        this.updateScroll();
    }

    scroll(vec2, amount) {
        const oldScale = this.scale;
        this.scale = clamp(this.scale * (1 - amount * this.scrollSpeed), this.minScale, this.maxScale);
        const move = this.globalToLocalCoords(vec2).add(this.offset).mul((oldScale - this.scale) / oldScale);

        this.updateScroll();
        this.moveMap(move);
    }

    wheel(event) {
        // Don't zoom if hovering element that has scrollbar
        if (event.target === this.mapContainer || event.target === this.map || event.target.scrollHeight <= event.target.clientHeight) {
            this.scroll(event.vec2(), event.deltaY / 750);
        }
        event.preventDefault();  // Prevents ctrl+scroll and also pinch zooming on laptop
    }

    dragStart(event, mouse, coords) {
        if (this.checkCanDrag(event, coords)) {
            this.dragStartMouse = mouse;
            this.dragStartCoords = coords;
            this.hasDraggedOverThreshold = false;

            // if (this.activeEditingNote) {
            event.preventDefault();
            // }
        }
    }

    dragDuring(event, mouse, coords) {
        if (this.dragStartCoords) {

            // let x = "";
            // for (const touch of event.touches) {
            //     x += "\n" + Math.round(touch.pageX) + "," + Math.round(touch.pageY);
            // }
            // this.log(x);

            const move = coords.sub(this.dragStartCoords);
            this.moveMap(move);

            if (!this.hasDraggedOverThreshold && mouse.sub(this.dragStartMouse).length() > this.clickDistanceThreshold) {
                this.hasDraggedOverThreshold = true;
                this.hookThresholdDragStart(event);
            }
        }
    }

    dragStop(event) {
        this.dragStartMouse = null;
        this.dragStartCoords = null;
        if (this.hasDraggedOverThreshold) {
            this.hookThresholdDragStop(event);
        }
    }

    _validLeftClick(event) {
        return event.isLeftClick() && (event.target === this.map || event.target === this.mapContainer);
    }

    touchStart(event) {
        this.touched = true;
        this.mouseDown(event);
        event.pinchAmount(); // To prevent spikes when pinch changes afterwards
    }

    touchMove(event) {
        const pinch = event.pinchAmount();
        if (pinch) {
            this.scroll(event.vec2(), -pinch / 100);
        }

        if (event.touches.length === this._previousTouchesLen) {
            this.mouseMove(event);
        }
        else {
            this.dragStop();  // To prevent camera jumping we reset drag to new fingers position
            this.mouseDown(event);
            this.hasDraggedOverThreshold = true;  // Prevent clicking when more than one fingers have touched
        }
        this._previousTouchesLen = event.touches.length;
    }

    touchEnd(event) {
        if (!event.touches.length) {
            this.mouseUp(event);
        }
    }

    mouseDown(event) {
        if (!this._validLeftClick(event)) return

        const mouse = event.vec2();
        const coords = this.globalToLocalCoords(mouse);
        this.mouseDownMouse = mouse;

        this.dragStart(event, mouse, coords);
        this.hookMouseDown(event, coords);
    }

    mouseMove(event) {
        const mouse = event.vec2();
        this.lastMoveMouse = mouse;
        const coords = this.globalToLocalCoords(mouse);

        // this.debug("cursor", coords);

        this.dragDuring(event, mouse, coords);
        if (!this.dragStartCoords) {
            this.lastMoveCoords = coords;
            this.hookMouseMoving(event, coords);
        }
    }

    mouseUp(event) {
        if (!this._validLeftClick(event)) return

        const mouse = event.vec2();
        const coords = this.globalToLocalCoords(mouse);
        this.dragStop(event);

        const markedOverThreshold = mouse.sub(this.mouseDownMouse).length() > this.clickDistanceThreshold;

        if (!this.hasDraggedOverThreshold && !markedOverThreshold) {
            this.hookClick(event, coords);
        }
        this.hookMouseUp(event, coords);
        this.touched = false;
    }

    mouseLeave(event) {
        this.dragStop(event);
    }

    moveMap(move) {
        this.offset = this.offset.add(move);
        this.map.setPos(this.offset.mul(this.scale), true);

        this.hookChangedCamera();
    }
}
