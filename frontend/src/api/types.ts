export interface paths {
  '/api/health': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              status: string;
              timestamp: string;
            };
          };
        };
      };
    };
  };
}
