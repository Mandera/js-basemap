

const Vec2 = require("genvector").Vec2;


export class _BaseMapBase {
    mapSize = 10000; // Just affects text highlighting when going outside
    defaultOffset = new Vec2(-this.mapSize);
    defaultScale = 1;

    constructor(name) {
        this.name = name;

        this.mapContainer = createEle(document.body, "div", "mapContainer");
        this.map = createEle(this.mapContainer, "div", "map");

        this.offset = new Vec2(this.defaultOffset);
        this.scale = this.defaultScale;

        this.map.setSize(this.mapSize * 2);

        this.updateMap();
    }

    centerCoords() {
        return this.globalToLocalCoords(this.mapContainer.getGlobalPos());
    }

    globalToLocalCoords(globalVec2) {
        return globalVec2.sub(this.mapContainer.getGlobalPos(true)).div(this.scale).sub(this.offset);
    }

    debug(name, coords) {
        name = "debugging-" + name;
        if (!this[name]) {
            this[name] = this.createEle("div", 0, 10, "debug");
        }
        this[name].setPos(coords);
    }

    updateMap() {
        this.moveMap(0);
        this.updateScroll();
    }

    moveMap(move) {
        this.offset = this.offset.add(move);
        this.map.setPos(this.offset.mul(this.scale), true);

        this.hookChangedCamera();
    }
}
