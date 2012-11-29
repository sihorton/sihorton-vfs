var fs = require('fs')
	path = require('path');

/**
* A virtual file system served from a file on disk.
*/
var appfs = function(mountpath, stats, readyCall) {
	var Me = {
		mountpath:mountpath
		,msize:stats.size
		/* footer info    */
		,footerSize:(4*3)+16
		,dirPos:undefined
		,fileFormatv:0
		,flagv:0
		,dirs:undefined
		/* footer info end*/
		
		/**
		*_readFooter reads in the footer information and the directory listing
		* no need to call this directly, it is done when the file is mounted.
		*/
		,_readFooter:function(footerRead) {
			var readStream = fs.createReadStream(Me.mountpath,{start:Me.msize-Me.footerSize});
			readStream.on('data', function(buff) {
				//assume it reads the whole footer in one go.
				var offset = 0;
				var str = buff.slice(0,16).toString();offset+=16;
				Me.dirPos = buff.readUInt32LE(offset);offset+=4;
				Me.fileFormatv = buff.readUInt32LE(0);offset+=4;
				Me.flagv = buff.readUInt32LE(0);offset+=4;
			});
			readStream.on('end',function() {
				//we read in the whole buffer.
				//read the directory listing and cache it.
				var readDir = fs.createReadStream(Me.mountpath,{start:Me.dirPos,end:Me.msize-(Me.footerSize+1)});
				var dat = '';
				readDir.on('data',function(data) {
					dat+=data;
				});
				readDir.on('end',function() {
					//we have now read in the directory listing.
					Me.dirs = JSON.parse(dat);
					//tell caller we are ready.
					if (footerRead) footerRead(Me);
			
				});
			});
		}
		/* virtual file system, replicate fs style api */
		,stat:function(path, statCalling) {
			if (Me.dirs[path]) {
				statCalling(null,Me.dirs[path]);
			} else {
				//simulate read error
				var err = new Error("ENOENT, stat '"+path+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = path;
				statCalling(err);
			}
		},createReadStream:function(path,options) {
			/**
			* http://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
			* @ToDo support options.
			*/
			if (Me.dirs[path]) {
				var f = Me.dirs[path];
				if (f.start == f.end) {
					//cannot read 0 bytes so use a dummy zero length file instead.
					var zeroLengthFile = function () {
					  this.readable = true;
					};
					require('util').inherits(zeroLengthFile,require('stream'));
					return new zeroLengthFile();
				} else {
					return fs.createReadStream(Me.mountpath,{start:f.start,end:f.end-1});
				}
			} else {
				//@ToDo: create a new file
				var err = new Error("ENOENT, open '"+path+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = path;
				throw err;
			}
		}
	}
	Me._readFooter(readyCall);
}
/**
* Wrapper for a real directory on disk.
*/
var dirfs = function(mountpoint) {
	var Me = {
		basePath:mountpoint
	}
	return Me;
}
/**
* mount a file system from a particular path
* if directory provide an fs wrapper, if file open
* and provide appfs object.
*/
module.exports.Mount = function(mountpath, readyCall) {
	fs.stat(mountpath,function(err,stats) {
		if (err) console.log(err);
		if (stats.isDirectory()) {
			//passed a real directory on disk, return wrapper.
			var actual = dirfs(mountpath);
			if (readyCall) {
				readyCall(null, actual);
			}
		}
		if (stats.isFile()) {
			//find format from extension?
			switch(path.extname(mountpath)) {
				case '.appfs':
					//an application resource package.
					var virtual = new appfs(mountpath, stats,readyCall);
				break;
				default:
					throw "unknown format:"+mountpath;
				break;
			}
		}
	});
}