const express = require('express');
const app = express();
const http = require('http');
const {Server} = require("socket.io");
const cors = require("cors")
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
    },
});

app.use(cors());

rooms = [];

const generateRandomRoomCode = () => {
    let roomCode = '';
    const codeLength = 10;
    let uniqueCheck = false;

    while (!uniqueCheck) {
        for (let i = 0; i < codeLength; i++) {
            const randomAscii = Math.floor(Math.random() * 26) + 65;
            roomCode += String.fromCharCode(randomAscii);
        }
        duplicateFound = false;
        for (let i = 0; i < rooms.length; i++) {
            if (rooms[i].roomCode === roomCode) {
                duplicateFound = true;
                break;
            }
        }
        if (!duplicateFound)
            uniqueCheck = true;
    }
    return roomCode;
}

const getRoomIndexByRoomCode = roomCode => {
    let roomIndex = -1;
    for (let i = 0; i < rooms.length; i++){
        if (rooms[i].roomCode === roomCode){
            return i;
        }
    }
    return roomIndex;
}

const getPlayerIndexBySocketIDAndRoomCode = (roomCode, socketID) => {
    let roomIndex = getRoomIndexByRoomCode(roomCode);
    if (roomIndex === -1){
        return -1;
    }
    let playerIndex = -1;
    for (let i = 0; i < rooms[roomIndex].players.length; i++){
        if (socketID === rooms[roomIndex].players[i].socketID){
            return i;
        }
    }
    return playerIndex;
}

const questionResultAnalysis = (roomCode, questionIndex) => {
    let roomIndex = getRoomIndexByRoomCode(roomCode);
    let answeredCount = 0;
    let correctCount = 0;
    for (let i = 0; i < rooms[roomIndex].players.length; i++) {
        if (rooms[roomIndex].players[i].answers[questionIndex] !== undefined) {
            answeredCount += 1;
            if (rooms[roomIndex].players[i].answers[questionIndex] === rooms[roomIndex].processedQuiz.answers[questionIndex]){
                correctCount += 1;
            }
        }
    }
    return {
        answeredCount: answeredCount,
        correctCount: correctCount,
    }
}

const quizResultAnalysis = (roomCode) => {
    let roomIndex = getRoomIndexByRoomCode(roomCode);
    let maxResult = {preferredName: rooms[roomIndex].players[0].preferredName,score: rooms[roomIndex].players[0].score}
    let minResult = {preferredName: rooms[roomIndex].players[0].preferredName,score: rooms[roomIndex].players[0].score}
    let sum = 0;
    for (let i = 0; i < rooms[roomIndex].players.length; i++) {
        sum += rooms[roomIndex].players[i].score;
        if (rooms[roomIndex].players[i].score > maxResult.score)
            maxResult = {preferredName: rooms[roomIndex].players[i].preferredName, score: rooms[roomIndex].players[i].score};
        if (rooms[roomIndex].players[i].score < minResult.score)
            minResult = {preferredName: rooms[roomIndex].players[i].preferredName, score: rooms[roomIndex].players[i].score};
    }
    return {
        max: maxResult,
        min: minResult,
        avg: sum / rooms[roomIndex].players.length,
    }
}

const logRoomsStatus = () => {
    console.log('Current Room Status:');
    console.log(JSON.stringify(rooms, null, 4));
}

io.on('connection', (socket) => {
    socket.on('host-to-server', req => {
        if (req.message === 'create-room-request') {
            let newRoomCode = generateRandomRoomCode();
            let processedCorrectAnswerKey = new Array(req.quiz.questions.length);
            let processedOptions = new Array(req.quiz.questions.length);
            let processedQuestions = new Array(req.quiz.questions.length);
            for (let i = 0; i < req.quiz.questions.length; i++){

                processedQuestions[i] = req.quiz.questions[i].question;

                let random = Math.floor(Math.random() * 4);
                processedCorrectAnswerKey[i] = random;
                processedOptions[i] = new Array(4);
                processedOptions[i][random] = req.quiz.questions[i].correctAnswer

                let randomDecoyPosition = []
                for (let j = 0; j < 4; j++) {
                    if (j !== random)
                        randomDecoyPosition.push(j);
                }
                for (let j = 0; j < 3; j++){
                    let tempRandom = Math.floor(Math.random() * 3);
                    let temp = randomDecoyPosition[0];
                    randomDecoyPosition[0] = randomDecoyPosition[tempRandom];
                    randomDecoyPosition[tempRandom] = temp;
                }

                for (let j = 0; j < 3; j++) {
                    processedOptions[i][randomDecoyPosition[j]] = req.quiz.questions[i].decoyAnswers[j];
                }

            }
            rooms.push({
                hostSocketID: socket.id,
                quiz: req.quiz,
                processedQuiz: {
                    answers: processedCorrectAnswerKey,
                    options: processedOptions,
                    questions: processedQuestions
                },
                roomCode: newRoomCode,
                currentQuestionIndex: -1,
                state: 'wait', //Five available states: wait, preview, open, close, finish
                players: [],
            });
            socket.emit('server-to-host', {
                message: 'create-room-response',
                roomCode: newRoomCode,
                quizName: req.quiz.name,
            })

            console.log(`Create room request received.`);
            console.log('Request accepted. ' + newRoomCode + ' is created.');
        }
        if (req.message === 'preview-question-request'){
            let roomIndex = getRoomIndexByRoomCode(req.roomCode);
            let validRequest = false;
            let failureReason = '';
            if (roomIndex !== -1){
                if (rooms[roomIndex].hostSocketID === socket.id){
                    if (rooms[roomIndex].state === 'close' || rooms[roomIndex].state === 'wait') {
                        if (rooms[roomIndex].currentQuestionIndex + 1 < rooms[roomIndex].quiz.questions.length){
                            validRequest = true;
                        } else {
                            failureReason = 'No more available question.'
                        }

                    } else {
                        failureReason = 'Invalid game state.'
                    }
                } else{
                    failureReason = 'Socket requesting is not the host.'
                }

            } else {
                failureReason = 'Room code not found.'
            }
            if (!validRequest){
                socket.emit('server-to-host', {
                    message: 'preview-question-response',
                    success: false,
                    failureReason: failureReason,
                })
                logRoomsStatus();
                console.log(`Preview question request from ${req.roomCode} received.`)
                console.log(`Request denied. ${failureReason}`)
                return;
            }
            rooms[roomIndex].currentQuestionIndex += 1;
            rooms[roomIndex].state = 'preview';
            socket.emit('server-to-host', {
                message: 'preview-question-response',
                success: true,
                question: rooms[roomIndex].processedQuiz.questions[rooms[roomIndex].currentQuestionIndex],
                options: rooms[roomIndex].processedQuiz.options[rooms[roomIndex].currentQuestionIndex],
                answer: rooms[roomIndex].processedQuiz.answers[rooms[roomIndex].currentQuestionIndex],
                questionID: rooms[roomIndex].currentQuestionIndex
            })

            console.log(`Preview question request from ${req.roomCode} received.`);
            console.log('Request accepted');
        }
        if (req.message === 'open-question-request'){
            let roomIndex = getRoomIndexByRoomCode(req.roomCode);
            let validRequest = false;
            let failureReason = '';
            if (roomIndex !== -1){
                if (rooms[roomIndex].hostSocketID === socket.id){
                    if (rooms[roomIndex].state === 'preview') {
                        validRequest = true;
                    } else {
                        failureReason = 'Invalid game state.'
                    }
                } else{
                    failureReason = 'Socket requesting is not the host.'
                }
            } else {
                failureReason = 'Room code not found.'
            }
            if (!validRequest){
                socket.emit('server-to-host', {
                    message: 'open-question-response',
                    success: false,
                    failureReason: failureReason,
                })
                logRoomsStatus();
                console.log(`Open question request from ${req.roomCode} received.`);
                console.log(`Request denied. ${failureReason}`);
                return;
            }
            rooms[roomIndex].state = 'open';
            socket.emit('server-to-host', {
                message: 'open-question-response',
                success: true,
                players: rooms[roomIndex].players
            })
            socket.to(req.roomCode).emit('server-to-client', {
                message: 'open-question-notification',
                question: rooms[roomIndex].processedQuiz.questions[rooms[roomIndex].currentQuestionIndex],
                options: rooms[roomIndex].processedQuiz.options[rooms[roomIndex].currentQuestionIndex],
            })
            logRoomsStatus();
            console.log(`Open question request from ${req.roomCode} received.`);
            console.log(`Request accepted.`);

        }
        if (req.message === 'close-question-request') {
            let roomIndex = getRoomIndexByRoomCode(req.roomCode);
            let validRequest = false;
            let failureReason = '';
            if (roomIndex !== -1){
                if (rooms[roomIndex].hostSocketID === socket.id){
                    if (rooms[roomIndex].state === 'open') {
                        validRequest = true;
                    } else {
                        failureReason = 'Invalid game state.'
                    }
                } else{
                    failureReason = 'Socket requesting is not the host.'
                }
            } else {
                failureReason = 'Room code not found.'
            }
            if (!validRequest){
                socket.emit('server-to-host', {
                    message: 'close-question-response',
                    success: false,
                    failureReason: failureReason,
                })
                console.log(`Close question request from ${req.roomCode} received.`);
                console.log(`Request denied. ${failureReason}`);
                return;
            }
            rooms[roomIndex].state = 'close';

            for (let i = 0; i < rooms[roomIndex].players.length; i++) {
                if (rooms[roomIndex].players[i].answers[rooms[roomIndex].currentQuestionIndex] === rooms[roomIndex].processedQuiz.answers[rooms[roomIndex].currentQuestionIndex]) {
                    rooms[roomIndex].players[i].score += 1;
                }
            }

            socket.emit('server-to-host', {
                message: 'close-question-response',
                success: true,
                players: rooms[roomIndex].players,
                questionAnalysis: questionResultAnalysis(req.roomCode, rooms[roomIndex].currentQuestionIndex),
                lastQuestion: rooms[roomIndex].currentQuestionIndex === rooms[roomIndex].quiz.questions.length -1
            })

            for (let i = 0; i < rooms[roomIndex].players.length; i++) {
                socket.to(rooms[roomIndex].players[i].socketID).emit('server-to-client', {
                    message: 'close-question-notification',
                    answer: rooms[roomIndex].processedQuiz.answers[rooms[roomIndex].currentQuestionIndex],
                    score: rooms[roomIndex].players[i].score
                })
            }
            console.log(`Close question request from ${req.roomCode} received.`);
            console.log(`Request accepted.`);
        }
        if (req.message === 'quiz-result-request') {
            let roomIndex = getRoomIndexByRoomCode(req.roomCode);
            let validRequest = false;
            let failureReason = '';
            if (roomIndex !== -1){
                if (rooms[roomIndex].hostSocketID === socket.id){
                    if (rooms[roomIndex].state === 'close' && rooms[roomIndex].currentQuestionIndex === rooms[roomIndex].quiz.questions.length - 1) {
                        validRequest = true;
                    } else {
                        failureReason = 'Invalid game state.'
                    }
                } else{
                    failureReason = 'Socket requesting is not the host.'
                }
            } else {
                failureReason = 'Room code not found.'
            }
            if (!validRequest){
                socket.emit('server-to-host', {
                    message: 'quiz-result-response',
                    success: false,
                    failureReason: failureReason,
                })
                console.log(`Quiz result request from ${req.roomCode} received.`);
                console.log(`Request denied. ${failureReason}`);
                return;
            }
            rooms[roomIndex].state = 'finish';
            socket.emit('server-to-host', {
                message: 'quiz-result-response',
                success: true,
                quizAnalysis: quizResultAnalysis(req.roomCode)
            })

            for (let i = 0; i < rooms[roomIndex].players.length; i++) {
                socket.to(rooms[roomIndex].players[i].socketID).emit('server-to-client', {
                    message: 'quiz-result-notification',
                    quizAnalysis: {
                        numOfQuestions: rooms[roomIndex].quiz.questions.length,
                        score: rooms[roomIndex].players[i].score,
                        average: quizResultAnalysis(req.roomCode).avg,
                    }
                })
            }
            console.log(`Quiz result request from ${req.roomCode} received.`);
            console.log(`Request accepted.`);
        }
        if (req.message === 'terminate-quiz-request') {
            let roomIndex = getRoomIndexByRoomCode(req.roomCode);
            let validRequest = false;
            let failureReason = '';
            if (roomIndex !== -1){
                if (rooms[roomIndex].hostSocketID === socket.id){
                    if (rooms[roomIndex].state === 'finish') {
                        validRequest = true;
                    } else {
                        failureReason = 'Invalid game state.'
                    }
                } else{
                    failureReason = 'Socket requesting is not the host.'
                }
            } else {
                failureReason = 'Room code not found.'
            }
            if (!validRequest){
                socket.emit('server-to-host', {
                    message: 'terminate-quiz-response',
                    success: false,
                    failureReason: failureReason,
                })
                console.log(`Quiz termination request from ${req.roomCode} received.`);
                console.log(`Request denied. ${failureReason}`);
                return;
            }
            socket.emit('server-to-host', {
                message: 'terminate-quiz-response',
                success: true,
            })

            socket.to(req.roomCode).emit('server-to-client', {
                message: 'terminate-quiz-notification',
            })
            io.socketsLeave(req.roomCode);
            rooms = rooms.filter(room => room.roomCode != req.roomCode);

            console.log(`Quiz termination request from ${req.roomCode} received.`);
            console.log(`Request accepted.`);
        }
    });
    socket.on('client-to-server', req => {
        if (req.message === 'join-room-request'){
            let roomIndex = getRoomIndexByRoomCode(req.roomCode);

            if(roomIndex === -1){
                socket.emit('server-to-client', {
                    message: 'join-room-response',
                    success: false,
                })

                console.log(`Join room request from ${req.roomCode} received.`);
                console.log(`Request denied. Room code not found.`);
                return;
            }
            socket.join(req.roomCode);
            rooms[roomIndex].players.push({
                socketID: socket.id,
                preferredName: req.preferredName,
                answers: new Array(rooms[roomIndex].quiz.questions.length),
                score: 0,
            })
            socket.to(rooms[roomIndex].hostSocketID).emit('server-to-host', {
                message: 'join-room-notification',
                players: rooms[roomIndex].players
            })
            socket.emit('server-to-client', {
                message: 'join-room-response',
                success: true,
                roomCode: rooms[roomIndex].roomCode,
                quizName: rooms[roomIndex].quiz.name,
                player: rooms[roomIndex].players[getPlayerIndexBySocketIDAndRoomCode(rooms[roomIndex].roomCode, socket.id)]
            })
            console.log(`Join room request from ${req.roomCode} received.`);
            console.log(`Request accepted.`);
        }

        if (req.message === 'answer-question-request') {
            let roomIndex = getRoomIndexByRoomCode(req.roomCode);
            let validRequest = false;
            let failureReason = '';
            let playerSocketIndex = -1;
            if (roomIndex !== -1){
                for (let i = 0; i < rooms[roomIndex].players.length; i++){
                    if (rooms[roomIndex].players[i].socketID === socket.id){
                        playerSocketIndex = i;
                        break;
                    }
                }
                if (playerSocketIndex !== -1) {
                    if (rooms[roomIndex].players[playerSocketIndex].answers[rooms[roomIndex].currentQuestionIndex] === undefined){
                        if (rooms[roomIndex].state === 'open'){
                            validRequest = true;
                        }else {
                            failureReason = 'Invalid state.';
                        }

                    } else {
                        failureReason = 'Requested Socket has already answered this question';
                    }

                }else {
                    failureReason = 'Player does not belong to the room.'
                }
            }else {
                failureReason = 'Room Code not found in backend';
            }
            if(!validRequest) {
                socket.emit('server-to-client', {
                    message: 'answer-question-response',
                    success: false,
                    failureReason: failureReason
                })
                console.log(`Question answer request from ${req.roomCode} received.`);
                console.log(`Request denied. ${failureReason}`);
                return;
            }
            rooms[roomIndex].players[playerSocketIndex].answers[rooms[roomIndex].currentQuestionIndex] = req.playerAnswer;
            socket.emit('server-to-client', {
                message: 'answer-question-response',
                success: true,
            })
            socket.to(rooms[roomIndex].hostSocketID).emit('server-to-host', {
                message: 'answer-question-notification',
                players: rooms[roomIndex].players,
                questionAnalysis: questionResultAnalysis(req.roomCode, rooms[roomIndex].currentQuestionIndex)
            })
            console.log(`Question answer request from ${req.roomCode} received.`);
            console.log(`Request accepted. ${failureReason}`);

        }
    });
    socket.on("disconnect", reason => {
        zombieRooms = rooms.filter(room => room.hostSocketID === socket.id);
        for (let  i = 0; i < zombieRooms.length; i++) {
            socket.to(zombieRooms[i].roomCode).emit('server-to-host', {
                message: 'host-disconnected-notification',
            })
            io.socketsLeave(zombieRooms[i].roomCode);
            rooms = rooms.filter(room => room.roomCode != zombieRooms[i].roomCode);
            console.log(`Room ${zombieRooms[i].roomCode} is terminated due to host disconnection.`)
        }
    })
});

server.listen(3001, () => {
    console.log('server is running');
});

