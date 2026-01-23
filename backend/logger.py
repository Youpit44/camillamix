import logging
import os

LOG_PATH = os.path.join(os.path.dirname(__file__), 'actions.log')


def setup_logging():
    logger = logging.getLogger()
    # ensure basic console handler exists
    if not logger.handlers:
        ch = logging.StreamHandler()
        ch.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
        logger.addHandler(ch)
    # add file handler
    fh = logging.FileHandler(LOG_PATH)
    fh.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s'))
    logger.addHandler(fh)
    logger.setLevel(logging.INFO)
    return logger
