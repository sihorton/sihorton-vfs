var nodefs = require("fs");
var appfs = require("./sihorton-vfs.js");

waitingTests = 0;
var noWaiting =[];
var startTest = function() {
	waitingTests++;
}
var endTest = function() {
	waitingTests--;
	if (waitingTests == 0) {
		fn = noWaiting.pop();
		if (fn) fn();
	}
}
appfs.Mount(__dirname+"\\new-example.appfs",function(vfs) {
	console.log("\t",true,"appfs mounted");
	//console.log(vfs.dirs);
	startTest();
	nodefs.stat("not_found",function(nerr,nstats) {
		vfs.stat("not_found",function(err,stats) {
			console.log("\t",nerr.errno==err.errno,"stat() - not found - errno");
			console.log("\t",nerr.code==err.code,"stat() - not found - code");
			endTest();			
		});
	});
	startTest();
	vfs.stat("package.json",function(err,stats) {
		console.log("\t",stats != undefined,"stat() - stats object returned");
		endTest();			
	});
	//nodefs.createReadStream("not_found");
	//vfs.createReadStream("not_found");
	startTest();
	var read1 = vfs.createReadStream("package.json");
	read1.on('data',function(dat) {
		console.log("\t",true,"createReadStream - data event fired");
		endTest();	
	});
	startTest();
	read1.on('end',function() {
		console.log("\t",true,"createReadStream - end event fired");
		endTest();	
	});
	noWaiting.push(function() {
		//console.log("batch of tests run, starting writing tests.");
		//startTest();
		//var write1 = vfs.createWriteStream("test.txt");
		//write1.write("hello world test of write stream");
		//write1.end();
	});
});
appfs.Mount(__dirname+"\\write-example.appfs",function(vfs) {
	var write1 = vfs.createWriteStream("test.txt");
	write1.on('close',function() {
		console.log("wrote data");
		//close the fs..
		vfs._writeFooter(function() {
			console.log("wrote footer");
		});
	});
	write1.write("hello world test of write stream");
	write1.end();
});