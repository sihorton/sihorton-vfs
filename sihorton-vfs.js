var fs = require('fs')
	path = require('path');

/**
* A virtual file system served from a file on disk.
*/
var appfs = function(mountpath, stats, readyCall) {
	var Me = {
		mountpath:mountpath
		,msize:stats.size
		,mstatus:0
		,autoClose:true//automatically write the footer after each write
		//if this is not true then you can get corrupted files
		//but performance is lower.
		
		// footer info
		,footerOnDisk:false
		,footerModified:false
		,formatName:'a'
		,formatSize:16
		,footerSize:(4*3)+16
		,dirPos:undefined
		,fileFormatv:0
		,flagv:0
		,dirs:undefined
		// footer info end
		
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
					Me.footerOnDisk = true;
					Me.footerModified = false;
					//tell caller we are ready.
					if (footerRead) footerRead(Me);
			
				});
			});
		}
		/**
		*_writeFooter writes footer info to file
		* no need to call this directly, it is called through other methods.
		*/
		,_writeFooter:function(footerWritten) {
			//just to be safe re-stat to find size.
			//fs.stat(Me.mountpath,function(err,stats) {
			//Me.dirPos = stats.size;
				var footer1 = fs.createWriteStream(Me.mountpath,{flags:'a'});
				footer1.write(JSON.stringify(Me.dirs));
				
				//write buffer record..
				var Buffer = require('buffer').Buffer;
				var bundleRecord = new Buffer(Me.footerSize);
				
				var offset = 0;
				var writeInt32 = function (buffer, data) {
					buffer[offset] = data & 0xff;
					buffer[offset + 1] = (data & 0xff00) >> 0x08;
					buffer[offset + 2] = (data & 0xff0000) >> 0x10;
					buffer[offset + 3] = (data & 0xff000000) >> 0x18;
					offset += 4;        
				};
				var writeString = function(buffer, str,size) {
					var strBuf = new Buffer(size);
					strBuf.fill(" ");
					strBuf.write(str);
					buffer.write(strBuf.toString(),offset,offset+size);
					offset += size;
				}
						
				writeString(bundleRecord,Me.formatName,Me.formatSize);
				writeInt32(bundleRecord,Me.dirPos);
				writeInt32(bundleRecord,Me.fileFormatv);
				writeInt32(bundleRecord,Me.flagv);
				footer1.write(bundleRecord);
				footer1.end();
				if (typeof footerWritten != 'undefined') {
					footerWritten();
				}
			//});
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
					if (typeof options == 'undefined') {
						options = {start:0,end:0};
					}
					if (!options['start'])options.start = 0;
					if (!options['end'])options.end = 0;
					
					options.start += f.start;
					options.end += f.end-1;
					if (options.end > f.end) {
						options.end = f.end-1;
					}
					return fs.createReadStream(Me.mountpath,options);
				}
			} else {
				//@ToDo: create a new file
				var err = new Error("ENOENT, open '"+path+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = path;
				throw err;
			}
		},createWriteStream:function(fpath, options) {
			//options not supported yet..
			//you can only open them one at a time..
			//we should start writing from the dirposition..
			var start = Me.dirPos;//Me.msize;
			//can append if no footer written, overwrite if it does not yet exist.
			var write1 = fs.createWriteStream(Me.mountpath,{flags:'a'});
			//var write1 = fs.createWriteStream(Me.mountpath,{flags:'r+',start:start});
			write1.on('close',function(err) {
				//file has now been appended, add it to the dirs.
				//we have two modes, one where dirs has not been written to file
				//and one where it has, so we will basically write over it
				//question is also if we want to auto add and write the dirs
				//after each file write...
				Me.dirs[fpath] = {
					start:Me.msize//Me.dirpos
					,name:path.basename(fpath)
				}
				fs.stat(Me.mountpath,function(err,stats) {
					Me.dirs[fpath].size = Me.msize-stats.size;
					Me.dirs[fpath].end = stats.size;
					Me.msize = stats.size;
					
					Me.dirs[fpath].atime = stats.atime;
					Me.dirs[fpath].mtime = stats.mtime;
					Me.dirs[fpath].ctime = stats.ctime;
					
				});
			});
			return write1;
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