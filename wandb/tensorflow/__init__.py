import tensorflow as tf
from wandb import util
from wandb.data_types import history_dict_to_json
from wandb.tensorboard import *
import wandb
from wandb.apis.file_stream import Chunk


class WandbHook(tf.train.SessionRunHook):
    def __init__(self, summary_op=None, steps_per_log=1000):
        self._summary_op = summary_op
        self._steps_per_log = steps_per_log

    def begin(self):
        if self._summary_op is None:
            self._summary_op = tf.summary.merge_all()
        self._step = -1

    def before_run(self, run_context):
        self._step += 1
        return tf.train.SessionRunArgs({"summary": self._summary_op})

    def after_run(self, run_context, run_values):
        if self._step % self._steps_per_log == 0:
            log(run_values.results["summary"])


def stream_tfevents(path, file_api, run, step=0, namespace=""):
    """Parses and streams a tfevents file to the server"""
    last_step = 0
    row = {}
    buffer = []
    last_row = {}
    global_step_key = namespaced_tag("global_step", namespace)
    for summary in tf.train.summary_iterator(path):
        parsed = tf_summary_to_dict(summary, namespace=namespace)
        if last_step != parsed[global_step_key]:
            step += 1
            row["_step"] = step
            last_step = parsed[global_step_key]
            # TODO: handle time
            if len(row) > 0:
                last_row = history_dict_to_json(run, row)
                file_api.push("wandb-history.jsonl", util.json_dumps_safer_history(last_row))
        row.update(parsed)
    # TODO: It's not clear to me why we still have wandb.data_types in last_row here,
    # but we do so we convert again
    return history_dict_to_json(run, last_row)


__all__ = ['log', 'patch', 'stream_tfevents', 'WandbHook']
