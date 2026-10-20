import fs from "fs";
import { feature } from "topojson-client";
import { geoNaturalEarth1, geoPath } from "d3-geo";

const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/countries-110m.json", "utf8"));
const fc = feature(topo, topo.objects.countries);
fc.features = fc.features.filter(f => f.properties.name !== "Antarctica");

const W = 1000;
const proj = geoNaturalEarth1().fitWidth(W, fc);
const path = geoPath(proj).digits(0);
const [[, y0], [, y1]] = path.bounds(fc);
const H = Math.ceil(y1);

const countries = fc.features.map(f => [f.properties.name, path(f) || ""]).filter(c => c[1]);
const out = { w: W, h: H, k: proj.scale(), t: proj.translate(), c: countries };
fs.writeFileSync("src/components/map/world.json", JSON.stringify(out));
console.log(countries.length, "countries", H, "tall", (JSON.stringify(out).length / 1024).toFixed(1) + " KB", "top", y0.toFixed(1));
