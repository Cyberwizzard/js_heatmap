
var width = 10;
var height = 5;

// 0 = air
// 1 = wall
// 2 = internal door
// 3 = external door / external window

var floorplan = [
	[ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ],
	[ 1, 0, 0, 0, 0, 0, 0, 0, 0, 1 ],
	[ 1, 0, 0, 0, 0, 0, 0, 0, 0, 1 ],
	[ 1, 0, 0, 0, 0, 0, 0, 0, 0, 1 ],
	[ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 ]
];

// Floorplan constants
var FP_AIR      = 0;	// Air, or any other medium where the sensor readings can permeate
var FP_WALL     = 1;	// Wall, impenetrable barrier - considered to have no influence on the 'heat' distribution
var FP_DOOR     = 2;	// Door, can be open or closed - NOT YET IMPLEMENTED
var FP_EXT_DOOR = 3;	// Exterior door or window, considered a temperature source when open or ignored when closed - NOT YET IMPLEMENTED

// Renderer settings
var block_size   = 4;	    // in pixels, the size of each square making up the floorplan
var legend       = 1;		// Enable or disable the legend completely
var legend_start = 4000;	// Start value of the legend (to invert, simply swap start and end and set the step to a negative value)
var legend_end   = 0;	    // End value of the legend
var legend_x     = 400;		// X location of the legend in pixels
var legend_y     = 10;		// Y location of the legend in pixels
var legend_h     = 300;		// Height of the legend
var legend_w     = 20;		// Width of the legend
var legend_step  = -500;	// Step size for the side print
var legend_scale = 100;		// Scale factor for the side print values: set to 1 to keep, set to 100 to divide the value shown by 100

var map = Array();	// value map to be applied to the floorplan, iteratively updated until a steady point is reached
var map_seed = 100;	// seed value for non-measurment points, used as a base to begin working towards hysterisis - the average value in your house is the best value here

var sensors = Array();	      // Each entry is a measuring point (one sensor can have multiple points), each entry is an object of a tripple: id, x, y, value
var sensor_map = null;	      // 2d matrix denoting for each square, to which sensor it should initially map - used to give the floorplan sane initial values
var sensor_static_map = null; // Marks for each field on the map wether its a static field (sensor measurement), which should not be updated during the map blending

var sensor_values = Array();	// Sparsely indexed array mapping a sensor ID to a value

function drawLegend(canvasName) {
	if(legend == 0) return;
	
	var canvas = document.getElementById(canvasName);
	var context = canvas.getContext('2d');
	
	// Set the font
	context.font = "12px Verdana";
	
	// Value of the current row in the legend
	var value = legend_start;
	// Size of each step over the values per row of pixels
	var step_size = (legend_end - legend_start) / legend_h;
	// Flag to draw a marker and print a value, true every time legend_step values are drawn
	var mark = 1;
	var mark_val = legend_start;
	var next_mark_val = legend_start + legend_step;
	
	// Draw one line per row of pixels
	// TODO support drawing thicker lines to speed up the process
	context.lineWidth = 1;
	
	for(yy = 0; yy <= legend_h; yy++) {
		y = legend_y + yy;
		x1 = legend_x;
		x2 = legend_x + legend_w;
		
		context.beginPath();
		context.moveTo(x1, y);
		context.lineTo(x2, y);

		context.strokeStyle = mapToCol(value);
		context.stroke();
		
		// Test if a marker should be drawn
		if((legend_step < 0 && next_mark_val > value) || (legend_step > 0 && next_mark_val < value)) {
			mark = 1;							// Flag to draw a marker
			mark_val = next_mark_val;			// Set the value to print to the trigger value
			next_mark_val += legend_step;		// Update the trigger value to the next value
		}
		
		// Last line is also always marked
		//if(yy == legend_h - 1) mark = 1;
		
		// If this is a 'mark' show it
		if(mark) {
			context.beginPath();
			context.moveTo(x2, y);
			context.lineTo(x2 + 10, y);
			context.strokeStyle = '#000000';
			context.stroke();
			
			context.fillText("" + (mark_val / legend_scale),x2+10,y);
			
			// Clear the flag
			mark = 0;
		}

		// Move to next value
		value += step_size;
	}	
}

function componentToHex(c) {
    var hex = Math.round(c).toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

function rgbToHex(r, g, b) {
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

/**
 * Interpolates between 2 colors to create a gradient.
 * TODO: support interpolation via HSV, will be slower but more accurate.
 * @return color string
 */
function interpolateColors(col1, col2, fraction) {
	if(fraction < 0) {
		console.log("Invalid fraction given: " + fraction);
		fraction = 0;
	} else if(fraction > 1.0) {
		console.log("Invalid fraction given: " + fraction);
		fraction = 1;
	}
	
	r = Math.round(col2.r * fraction + col1.r * (1 - fraction));
	g = Math.round(col2.g * fraction + col1.g * (1 - fraction));
	b = Math.round(col2.b * fraction + col1.b * (1 - fraction));
	return rgbToHex(r,g,b);
}

// Predefined constants used by mapToCol to generate the 'heat' map
colmap_whitered	  = {r: 255, g: 107, b: 107};
colmap_red	      = {r: 255, g:  17, b:  17};
colmap_yellow	  = {r: 255, g: 233, b:  17};
colmap_green	  = {r:  14, g: 212, b:  14};
colmap_blue       = {r:  22, g:  41, b:  85};
colmap_purple     = {r:  92, g:  28, b: 123};
colmap_blackgreen = {r:  50, g:  83, b:  60};

/*
 * Maps a value to a color, range: 3500 to 0 (divide by 100 to get the actual sensor value).
 * Color scale:
 *   > 3500 : whitish red
 *   3000:    red
 *   2600:    yellow
 *   2000:    green
 *   1500:    blue
 *   1000:    purple
 *   <  0:    black-green
 */
function mapToCol(value) {
	if(value > 3500) {
		return rgbToHex(colmap_whitered.r, colmap_whitered.g, colmap_whitered.b);
	} else if(value < 0) {
		return rgbToHex(colmap_blackgreen.r, colmap_blackgreen.g, colmap_blackgreen.b);
	} else if(value >= 3000) {
		frac = (value - 3000) / 500;
		return interpolateColors(colmap_red, colmap_whitered, frac);
	} else if(value >= 2600) {
		frac = (value - 2600) / 400;
		return interpolateColors(colmap_yellow, colmap_red, frac);
	} else if(value >= 2000) {
		frac = (value - 2000) / 600;
		return interpolateColors(colmap_green, colmap_yellow, frac);
	} else if(value >= 1500) {
		frac = (value - 1500) / 500;
		return interpolateColors(colmap_blue, colmap_green, frac);
	} else if(value >= 1000) {
		frac = (value - 1000) / 500;
		return interpolateColors(colmap_purple, colmap_blue, frac);
	} else {
		frac = value / 1000;
		return interpolateColors(colmap_blackgreen, colmap_purple, frac);
	}
}

/**
 * Fill the map with sensor values based on the sensor_map allocation. This is the initial seed.
 * @param def Default value for fields not belonging to a sensor
 */
function initializeMap(def) {
	if(map.length != height || map[0].length != width)
		map = create2dMatrix(width, height, def);
	
	for(y = 0; y < height; y++) {
		for(x = 0; x < width; x++) {
			if(floorplan[y][x] != 0) {
				// Not air, erase any old value
				map[y][x] = 0;
			} else {
				sensor_id = sensor_map[y][x];
				if(sensor_id == -1)
					map[y][x] = def;
				else {
					// Get the sensor value for this ID
					console.log("("+x+","+y+"): belongs to " + sensor_id + " set to " + getSensorValue(sensor_id));
					map[y][x] = getSensorValue(sensor_id);
				}
			}
		}
	}
}

function getSensorValue(id) {
	if(typeof sensor_values[id] != "undefined") {
		return sensor_values[id];
	}
	return -1;
}

function createSensor(x, y, id) {
	// Create sensor object
	// TODO support bigger areas
	s = {x: x, y: y, id: id, w: 1, h: 1};
	sensors[sensors.length] = s;
}

function setSensorValue(id, value) {
	sensor_values[id] = value;
}

/**
 * Use the virtual sensors from the 'sensors' array to populate the 'sensor_map': a 2D grid containing the ID of the sensor
 * assigned to each field. In order to seed the measurement 'map', each field should belong to a sensor for the initial state.
 * When fields are unassigned, fields 'inherit' the associated sensor ID from neighbouring fields until the sensor_map is fully
 * defined. Note that when fields around an unassigned field belong to multiple sensor IDs, the sensor ID which is assigned to
 * the most adjecent fields will be chosen.
 * This is an iterative algorithm which 'grows' the sensor regions until the map is fully defined. In order to save time, it is
 * recommended to save the 'sensor_map' using HTML5 storage in order to quickly compute the heat map on each sensor value update.
 */
function computeSensorMap() {
	// Create an empty map
	sensor_map = create2dMatrix(width, height, -1);
	
	// Sanity check
	if(sensors.length == 0) throw "No sensors defined";
	
	// Copy the sensors in there
	sensors.forEach(function(obj) {
		sensor_map[obj.y][obj.x] = obj.id;
	});
	
	// 'Grow' the sensor map by repeatedly iterating over the map, and assigning sensor IDs to each square until all 
	// fields are assigned.
	hasMore = 1;
	while(hasMore) {
		hasMore = 0;	// start with the assumption no fields are unassigned
		
		// Note, ignore outer fields
		for(y = 1; y < height - 1; y++) {
			for(x = 1; x < width - 1; x++) {
				// If this a field containing air and the sensor_map is unassigned, see if there is an adjecent 
				// field which belongs to a sensor which can be propagated in this field.
				if(floorplan[y][x] == 0 && sensor_map[y][x] == -1) {
					neighbours = [];
					
					// Open unassigned field - find the sensor id which is most around it to populate
					for(yy = -1; yy <= 1; yy++) {
						for(xx = -1; xx <= 1; xx++) {
							if(xx == 0 && yy == 0) continue;
							xxx = x + xx;
							yyy = y + yy;
							// Fetch the sensor ID belonging to this field, if any
							sensor_id = sensor_map[yyy][xxx];
							
							if(sensor_id > -1) {
								// valid sensor id found, count the number occurences of this ID in neighbouring cells
								if(typeof neighbours[sensor_id] == 'undefined') neighbours[sensor_id] = 0;
								neighbours[sensor_id]++;
							}
						}
					}
					
					// Process scan results: find sensor id which is most present around this field
					sensor_id = -1;
					sensor_cnt = 0;
					neighbours.forEach(function(cnt, id) {
						if(cnt > sensor_cnt) {
							// This sensor has more adjecent fields
							sensor_id = id;
							sensor_cnt = cnt;
						}
					});
					
					// See if we have a winner
					if(sensor_id != -1) sensor_map[y][x] = sensor_id;
					else {
						// No adjecent sensor for this field yet, mark map as not done
						hasMore = 1;
						// TODO handle rooms which are closed off: without a sensor in there this will never end	
					}
				}
			} // loop x
		} // loop y
	} // while hasMore
}

function updateMap() {
	if(map.length == 0) initMap();
	
	// Copy the matrix on update
	var newmap = copy2dMatrix(map);
	
	// Update the map
	// TODO: create the map while applying the kernel maybe? Then the copy is only done during aggregation?
	for(y = 1; y < height - 1; y++) {
		for(x = 1; x < width - 1; x++) {
			if(floorplan[y][x] != 0) continue;		// if this field does not contain air, do not update it
			if(sensor_static_map[y][x]) continue;	// if this is a static field, do not update it
			
			// Update the square at x,y
			cnt = 0;
			avg = 0;
			for(xx = -1; xx <= 1; xx++) {
				for(yy = -1; yy <= 1; yy++) {
					xxx = x + xx;
					yyy = y + yy;
					if(xx == 0 && yy == 0) continue;
					//console.log("Compute x: "+x+" y: "+y+" sub x: " + xxx + " sub y: " + yyy);
					
					// TODO handle doors and such
					if(floorplan[yyy][xxx] == 0) {
						avg += map[yyy][xxx];
						cnt++;
					}
		
					if(cnt > 0)
						newmap[y][x] = avg / cnt;
				}
			}
		}
	}
	
	// Copy the values back to the map
	map = newmap;
}

function drawFloorPlan(canvasName) {
	var canvas = document.getElementById(canvasName);
	var context = canvas.getContext('2d');
	
	for(y = 0; y < height; y++) {
		for(x = 0; x < width; x++) {
			col = "#000000";
			switch(floorplan[y][x]) {
				case 0: // Air
					//col = mapToCol( map[y][x] );
					col = getColorForField(x,y,0);
					console.log("X: " + x + " Y: " + y + " col: " + col);
					break;
				case 1: // Wall
					col = "#000000";
					break;
				case 2: // Internal door
					col = "#00FF00";
					break;
				case 3: // External door / window
					col = "#00FFFF";
					break;
			}
			
			context.fillStyle = col;
			context.fillRect(x * block_size, y * block_size, block_size, block_size);
		}
	}
}

function getColorForField(x, y, drawMode) {
	switch(drawMode) {
		case 0: // Standard: draw the sensor value map on top of the floorplan
			return mapToCol( map[y][x] );
	}	
	
}

function create2dMatrix(w, h, def) {
	rows = new Array(h);
	//rows = rows.map(function(v) { col = new Array(w); if(def != 0) col.fill(def); return col; });
	for(r = 0; r < h; r++) {
		col = new Array(w);
		col.fill(def);
		rows[r] = col;
	}
	return rows;
}

function copy2dMatrix(src) {
	len = src.length;
	res = new Array(len);
	for(i=0; i<len; i++) {
		res[i] = src[i].slice(0);
	}
	return res;
}

function createFloorPlan(new_width, new_height) {
	width = new_width;
	height = new_height;
	
	floorplan = create2dMatrix(width, height, 0);
	
	createWall(0,0, width-1, 0);
	createWall(0,height-1, width-1, height-1);
	createWall(0,0, 0, height-1);
	createWall(width-1, 0, width-1, height-1);
	
	// When making a new floorplan, also remake the static map: each field marked as '1' will not be updated during blending
	sensor_static_map = create2dMatrix(width, height, 0);
}

function createWall(x1, y1, x2, y2) {
	if(x1 < 0 || x1 >= width) { console.log("x1 for createWall out of range: 0 - " + (width - 1) + ", got: " + x1); return; }
	if(x2 < 0 || x2 >= width) { console.log("x2 for createWall out of range: 0 - " + (width - 1) + ", got: " + x2); return; }
	if(y1 < 0 || y1 >= height) { console.log("y1 for createWall out of range: 0 - " + (height - 1) + ", got: " + y1); return; }
	if(y2 < 0 || y2 >= height) { console.log("y2 for createWall out of range: 0 - " + (height - 1) + ", got: " + y2); return; }
	
	stepx = (x2 - x1);	// Step size on the x axis, begins as the delta
	stepy = (y2 - y1);  // Same for y
	steps = 1;			// Numer of steps: max(abs(stepx), abs(stepy))
	if(Math.abs(stepx) > Math.abs(stepy)) {
		steps = Math.abs(stepx);
	} else {
		steps = Math.abs(stepy);
	}
	
	// Scale the step size per axis
	stepx /= steps;
	stepy /= steps;
	
	// Create the wall on the floorplan
	for(i = 0; i <= steps; i++) {
		x = x1 + Math.round(i * stepx);
		y = y1 + Math.round(i * stepy);
		
		floorplan[y][x] = 1;
	}
}