export default (req, res, next) => {
    req.context = {
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      correlationId: req.headers['x-correlation-id'] || crypto.randomUUID()
    };
    next();
  };