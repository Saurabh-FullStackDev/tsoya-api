const multer = require('multer');
const sharp = require('sharp');
const User = require('../models/user.model');
const factoryHandlers = require('./factoryController');
const catchasync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const chatkit = require('../utils/chatkit');
const APIFeatures = require('../utils/apiFeatures');

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload only images.', 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter
});

// MIDDLEWARES
exports.uploadUserImages = upload.fields([
  { name: 'imageCover', maxCount: 1 },
  { name: 'publicImages', maxCount: 5 },
  { name: 'privateImages', maxCount: 5 }
]);

exports.resizeUserImages = catchasync(async (req, res, next) => {
  if (!req.files) {
    return next();
  }

  if (
    !req.files.imageCover ||
    !req.files.publicImages ||
    !req.files.privateImages
  )
    return next();

  if (req.body.imageCover) {
    // 1) Cover image
    req.body.imageCover = `user-${req.user._id}-${Date.now()}-cover.jpeg`;

    await sharp(req.files.imageCover[0].buffer)
      .resize(2000, 1333)
      .toFormat('jpeg')
      .jpeg({ quality: 90 })
      .toFile(`public/images/users/${req.body.imageCover}`);
  }

  // 2) Public and Private Images
  req.body.publicImages = [];
  req.body.privateImages = [];

  // Public Images
  await Promise.all(
    req.files.publicImages.map(async (file, i) => {
      const filename = `user-${req.user._id}-${Date.now()}-${i +
        1}-public.jpeg`;

      await sharp(file.buffer)
        .resize(2000, 1333)
        .toFormat('jpeg')
        .jpeg({ quality: 90 })
        .toFile(`public/images/users/${filename}`);

      req.body.publicImages.push(filename);
    })
  );

  // Private Images
  await Promise.all(
    req.files.privateImages.map(async (file, i) => {
      const filename = `user-${req.user._id}-${Date.now()}-${i +
        1}-private.jpeg`;

      await sharp(file.buffer)
        .resize(2000, 1333)
        .toFormat('jpeg')
        .jpeg({ quality: 90 })
        .toFile(`public/images/users/${filename}`);

      req.body.privateImages.push(filename);
    })
  );

  next();
});

// Filter some fields for Update , FUNCTIONS
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach(el => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

// QUERIES
exports.updateMe = catchasync(async (req, res, next) => {
  if (req.body.password) {
    return next(
      new AppError(
        'Password here is not allowed to Update, use /forgotpassword for that',
        400
      )
    );
  }

  const filteredBody = filterObj(
    req.body,
    'name',
    'email',
    'male',
    'age',
    'sexOrientation',
    'about',
    //'imageCover',
    'publicImages',
    'privateImages'
  );

  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true
  });

  await chatkit.updateUser({
    id: req.body.name,
    name: req.body.name
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser
    }
  });
});

exports.favouriteUser = catchasync(async (req, res, next) => {
  const userId = req.user.id;
  const favouriteUserId = req.params.id;

  console.log(userId, favouriteUserId);

  const { favourites } = await User.findById(userId);

  if (favourites.includes(favouriteUserId)) {
    console.log('User already in favoruites !!');
    return;
  }

  const user = await User.findByIdAndUpdate(userId, {
    $push: { favourites: favouriteUserId }
  }).select('-password -passwordChangedAt');

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });

  // if (favourites == favouriteUserId) {
  //   return next(new AppError('This user is already in your favourites!', 400));
  // } else {
  //   favourites.forEach(async (el, i) => {
  //     if (el == favouriteUserId) {
  //       return next(
  //         new AppError('This user is already in your favourites!', 400)
  //       );
  //       // eslint-disable-next-line no-else-return
  //     } else {
  //       const user = await User.findByIdAndUpdate(userId, {
  //         $push: { favourites: favouriteUserId }
  //       }).select('-password -passwordChangedAt');

  //       res.status(200).json({
  //         status: 'success',
  //         data: {
  //           user
  //         }
  //       });
  //     }
  //   });
  // }
});

exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};

exports.myFavourites = catchasync(async (req, res) => {
  const { favourites } = await User.findById(req.params.id).populate(
    'favourites'
  );

  res.status(200).json({
    status: 'success',
    data: {
      favourites
    }
  });
});

exports.createRoom = catchasync(async (req, res, next) => {
  console.log(req.body);

  try {
    await chatkit.getRoom({
      roomId: `${req.user.name}-${req.body.user}`
    });

    return new AppError('The room already exists !!', 400);
  } catch (err) {
    const room = await chatkit.createRoom({
      id: `${req.user.name}-${req.body.user}`,
      creatorId: req.user.name,
      name: `${req.user.name}-${req.body.user}`,
      isPrivate: true,
      userIds: [req.user.name, req.body.user]
    });

    res.status(201).json({
      status: 'success',
      data: room
    });
  }
});

exports.updateRoom = catchasync(async (req, res, next) => {
  console.log(req.body.id);

  const room = await chatkit.getRoom({
    roomId: req.body.id
  });

  console.log(room);

  await chatkit.updateRoom({
    id: req.body.id,
    name: room.name,
    isPrivate: true,
    customData: {
      convesationNotes: req.body.conversationNotes
    }
  });

  res.status(200).json({
    status: 'success',
    data: {
      message: 'Room Update successfull'
    }
  });
});

exports.getAllUsers = catchasync(async (req, res, next) => {
  let features;

  if (req.user.role === 'user') {
    features = new APIFeatures(
      User.find({ userAdmin: { $ne: null } }).select(
        '-privateImages -password -passwordChangedAt'
      ),
      req.query
    )
      .filter()
      .sort();
  } else {
    features = new APIFeatures(
      User.find().select('-privateImages -password -passwordChangedAt'),
      req.query
    )
      .filter()
      .sort();
  }

  const data = await features.query;

  res.status(200).json({
    status: 'success',
    results: data.length,
    message: {
      data
    }
  });
});

// Controlling Message send by Admin or User
exports.messageControl = catchasync(async (req, res, next) => {
  const { receiverName, roomId, text } = req.body;
  console.log(receiverName, 'receiver name');

  let updatedUser;

  // Sending Message
  chatkit
    .sendSimpleMessage({
      userId: req.user.name,
      roomId,
      text
    })
    .then(async messageRes => {
      console.log('sent message with id', messageRes.id);

      const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
      ];

      const thisMonth = months[new Date().getMonth()];

      const { userAdmin } = await User.findOne({ name: receiverName });
      console.log(userAdmin, 'USER ADMIN');

      console.log(req.user.role);
      if (req.user.role === 'user') {
        const { credits } = await User.findById(req.user._id);
        // if (credits < 40) {
        //   return next(
        //     new AppError(
        //       'You have no enough enougn credits, Buy more credits to send messages!',
        //       403
        //     )
        //   );
        // }

        // Updating Sender
        updatedUser = await User.findByIdAndUpdate(req.user.id, {
          $inc: { credits: -40 }
        });
        console.log(updatedUser);

        // Updating User profile receiver
        const updatedAdminprofile = await User.updateOne(
          {
            name: receiverName,
            'stats.month': thisMonth
          },
          { $inc: { 'stats.$.receive': 1 } }
        );
        console.log(updatedAdminprofile);

        await User.updateOne(
          {
            _id: userAdmin,
            'stats.month': thisMonth
          },
          { $inc: { 'stats.$.receive': 1 } }
        );
      } else if (req.user.role === 'admin') {
        // Updating User profile receiver
        updatedUser = await User.updateOne(
          {
            name: req.user.name,
            'stats.month': thisMonth
          },
          { $inc: { 'stats.$.send': 1 } }
        );

        const __user = await User.findOne({
          _id: req.user.userAdmin
        });

        console.log(__user, 'ADMIN!!!!');

        await User.updateOne(
          {
            _id: req.user.userAdmin,
            'stats.month': thisMonth
          },
          { $inc: { 'stats.$.send': 1 } }
        );

        console.log(updatedUser);
      }

      res.status(200).json({
        status: 'success',
        data: {
          updatedUser
        }
      });
    });
});

exports.getUser = factoryHandlers.getOne(User);
