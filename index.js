require('dotenv').config();
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
mongoose.Promise = require('bluebird');
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost/super-chat";
var auth = require('./routes/auth');
var api = require('./routes/api');
var http = require('http').Server(app);
var io = require('socket.io')(http);
const JWT_SECRET = process.env.JWT_SECRET;
const User = require('./models/user').User;
const UserStatus = require('./models/user').UserStatus;
var jwt = require('jsonwebtoken');
const Chat = require('./models/chat');

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname + "/dist/super-chat"));

// Frontend Route
app.get("/*", (req, res) => {
    res.sendFile(__dirname + "/dist/super-chat/index.html");
})

// Backend Routes
app.use('/auth', auth);
app.use('/api', api);

mongoose.connect(MONGODB_URI, { useNewUrlParser: true }, err => {
    if (err) {
        console.log('Error in connecting to database: ', err);
    } else {
        console.log('Connected to database: ', MONGODB_URI);
    }
})

io.on('connection', function (socket) {
    console.log('a user connected');

    socket.emit("hii", {});


    socket.on("active", (data, callback) => {
        jwt.verify(data.token, JWT_SECRET, (err, payload) => {
            if (err) {
                console.log('Error in verifying socket token: ', err);
                callback({ success: false, data: { msg: 'Something went wrong. Please try again' } });
            } else {
                User.findOne({ _id: payload._id }, (err, user) => {
                    if (err) {
                        console.log('Error in finding user from socket token: ', err);
                        callback({ success: false, data: { msg: 'Something went wrong. Please try again.' } });
                    } else {
                        if (user) {
                            user.socketId = socket.id;
                            user.status = UserStatus.ONLINE;
                            user.save((err, user) => {
                                if (err) {
                                    console.log('Error in changing user status: ', err);
                                    callback({ success: false, data: { msg: 'Something went wrong. Please try again' } });
                                } else {
                                    console.log(user.username, " is active with socket ", socket.id);
                                    callback({ success: true, data: { msg: 'Status changed successfully' } });
                                }
                            });
                        } else {
                            console.log('Invalid session for socketId: ', socket.id);
                            callback({ success: false, data: { msg: 'Invalid Session. Please login again.' } });
                        }
                    }
                })
            }
        })
    });

    socket.on("disconnect", () => {
        User.findOne({ socketId: socket.id }, (err, user) => {
            if (err) {
                console.log('Error in finding user for marking offline: ', err);
            } else {
                if (user) {
                    user.socketId = "";
                    user.status = UserStatus.OFFLINE;
                    user.save((err, user) => {
                        if (err) {
                            console.log('Error in saving user with status offline: ', err);
                        } else {
                            console.log(user.username, " is offline");
                        }
                    })
                } else {
                    console.log('User with socketId:', socket.id, ' not found for marking offline');
                }
            }
        })
    })

    socket.on("message", (data, callback) => {
        Chat.findOne({ _id: data.chatId })
            .populate('participants', {}, 'user')
            .exec((err, chat) => {
                if (err) {
                    console.log('Error in finding chat: ', err);
                    callback({ success: false, data: { msg: 'Something went wrong. Please try again.' } })
                } else {
                    if (chat) {
                        chat.messages.push(data.message);
                        chat.save(err => {
                            if (err) {
                                console.log('Error in saving message: ', err);
                                callback({ success: false, data: { msg: 'Could not send message at this moment' } })
                            } else {
                                chat.participants.forEach(participant => {
                                    if (participant._id != data.message.from) {
                                        io.sockets.to(participant.socketId).emit('message', data);
                                        callback({ success: true, data: { msg: 'Message sent successfully' } })
                                    }
                                })
                            }
                        })
                    } else {
                        console.log('Chat not found with id: ', data.chatId);
                        callback({ success: false, data: { msg: 'Requested chat not found' } });
                    }
                }
            })
    })

    socket.on('markAsRead', (data, callback) => {
        Chat.findOne({ _id: data.chatId })
            .exec((err, chat) => {
                if (err) {
                    console.log('Error in finding chat: ', err);
                    callback({ success: false, data: { msg: 'Something went wrong. Please try again.' } })
                } else {
                    if (chat) {
                        chat.messages.forEach(message => {
                            if (message.from == data.userId) {
                                message.status = "read";
                            }
                        });

                        chat.save(err => {
                            if (err) {
                                console.log('Error in updating chat: ', err);
                                callback({ success: false, data: { msg: 'Something went wrong. Please try again.' } })
                            } else {
                                console.log('Chat updated successfully');
                                callback({ success: true, data: { msg: 'Chat updated successfully' } });
                            }
                        })
                    } else {
                        console.log('Chat not found with id: ', data.chatId);
                        callback({ success: false, data: { msg: 'Sorry chat not found' } });
                    }
                }
            })
    });
});

http.listen(PORT, err => {
    if (err) {
        console.log('Error in starting server: ', err);
    } else {
        console.log('Server started successfully on port: ', PORT);
    }
})