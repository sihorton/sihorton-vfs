var appfs = require("./sihorton-vfs.js");

appfs.Mount(__dirname+"\\new-example.appfs",function(vfs) {
	console.log("test1:mounted ok.");
	console.log(vfs.dirs);
});