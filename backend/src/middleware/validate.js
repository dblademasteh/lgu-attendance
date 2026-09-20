export function validate(schema) {
  return (req, res, next) => {
    try {
      const shape = schema.shape ?? schema;
      const bodySchema = shape.body ?? schema.body;
      const paramsSchema = shape.params ?? schema.params;
      const querySchema = shape.query ?? schema.query;
      if (bodySchema?.parse) req.body = bodySchema.parse(req.body);
      if (paramsSchema?.parse) req.params = paramsSchema.parse(req.params);
      if (querySchema?.parse) {
        const parsed = querySchema.parse(req.query);
        // Express 5 req.query is a getter — assignment throws; defineProperty.
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      return next();
    } catch (e) {
      const issues = e.issues || e.errors || [];
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: issues[0]?.message || 'Invalid input', details: issues.map((i) => ({ path: i.path?.join('.'), message: i.message })) } });
    }
  };
}
